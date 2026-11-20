import { open } from 'node:fs/promises';
import { endianness } from 'node:os';

// BF16 and FP16 have the same element width, so the tensor offsets stay valid.
export async function convertFp16(source, destination) {
  if (endianness() !== 'LE') throw new Error('Expected a little-endian build host');
  await using input = await open(source);
  await using output = await open(destination, 'w');
  const prefix = Buffer.alloc(8);
  if ((await input.read(prefix)).bytesRead !== 8) throw new Error('Missing SafeTensors header');
  const header = Buffer.alloc(Number(prefix.readBigUInt64LE()));
  if ((await input.read(header)).bytesRead !== header.length) throw new Error('Truncated SafeTensors header');
  const tensors = JSON.parse(header);
  for (const [name, tensor] of Object.entries(tensors)) {
    if (name === '__metadata__') continue;
    if (tensor.dtype !== 'BF16') throw new Error(`Unexpected dtype for ${name}: ${tensor.dtype}`);
    tensor.dtype = 'F16';
  }
  const json = Buffer.from(JSON.stringify(tensors));
  const padded = Buffer.alloc(Math.ceil(json.length / 8) * 8, 32);
  json.copy(padded);
  prefix.writeBigUInt64LE(BigInt(padded.length));
  await output.writeFile(Buffer.concat([prefix, padded]));
  const bits = new Uint32Array(1);
  const float = new Float32Array(bits.buffer);
  const half = new Float16Array(65536);
  for (let i = 0; i < half.length; i++) { bits[0] = i << 16; half[i] = float[0]; }
  const lookup = new Uint16Array(half.buffer);
  const values = new Uint16Array(2 ** 21);
  const bytes = Buffer.from(values.buffer);
  for (;;) {
    const { bytesRead } = await input.read(bytes);
    if (!bytesRead) break;
    if (bytesRead % 2) throw new Error('Unaligned SafeTensors payload');
    for (let i = 0; i < bytesRead / 2; i++) {
      const value = lookup[values[i]];
      if ((value & 0x7c00) === 0x7c00) throw new Error('Nonfinite FP16 weight');
      values[i] = value;
    }
    await output.writeFile(bytes.subarray(0, bytesRead));
  }
}
