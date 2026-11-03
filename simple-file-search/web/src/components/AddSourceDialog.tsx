import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
  Textarea,
} from "@antfly/design-system/primitives";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api } from "../api";
import type { NewSource, SourceKind } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
  /** The server has GOOGLE_API_KEY, so public folders need no key here. */
  serverKey: boolean;
}

type Access = "public" | "private";

const EMPTY_S3 = {
  bucket: "",
  prefix: "",
  region: "us-east-1",
  endpoint: "",
  access_key_id: "",
  secret_access_key: "",
};

export function AddSourceDialog({
  open,
  onOpenChange,
  onAdded,
  serverKey,
}: Props) {
  const [kind, setKind] = useState<SourceKind>("s3");
  const [name, setName] = useState("");
  const [s3, setS3] = useState(EMPTY_S3);
  const [folder, setFolder] = useState("");
  const [access, setAccess] = useState<Access>("public");
  const [apiKey, setApiKey] = useState("");
  const [creds, setCreds] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setKind("s3");
    setName("");
    setS3(EMPTY_S3);
    setFolder("");
    setAccess("public");
    setApiKey("");
    setCreds("");
    setError("");
  };

  const email = useMemo(() => {
    try {
      const v = JSON.parse(creds) as { client_email?: unknown };
      return typeof v.client_email === "string" ? v.client_email : "";
    } catch {
      return "";
    }
  }, [creds]);

  const fallbackName = kind === "s3" ? s3.bucket.trim() : "Drive folder";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (kind === "drive" && access === "private" && !email) {
      setError(
        "The service account key doesn't look like JSON with a client_email.",
      );
      return;
    }
    const body: NewSource =
      kind === "s3"
        ? {
            kind: "s3",
            name: name.trim() || fallbackName,
            s3: {
              bucket: s3.bucket.trim(),
              prefix: s3.prefix.trim(),
              region: s3.region.trim(),
              endpoint: s3.endpoint.trim(),
              access_key_id: s3.access_key_id.trim(),
              secret_access_key: s3.secret_access_key,
            },
          }
        : {
            kind: "drive",
            name: name.trim() || fallbackName,
            drive:
              access === "private"
                ? { folder: folder.trim(), credentials_json: creds.trim() }
                : { folder: folder.trim(), api_key: apiKey.trim() },
          };
    setSaving(true);
    try {
      await api.addSource(body);
      await onAdded();
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const set =
    (k: keyof typeof EMPTY_S3) => (e: ChangeEvent<HTMLInputElement>) =>
      setS3((v) => ({ ...v, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add source</DialogTitle>
          <DialogDescription>
            Files become searchable as they sync.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-6">
          <div
            role="radiogroup"
            aria-label="Source type"
            className="grid grid-cols-2 rounded-md border border-input p-0.5"
          >
            {(["s3", "drive"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setError("");
                }}
                className={`h-8 rounded-sm text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                  kind === k
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "s3" ? "S3 bucket" : "Google Drive folder"}
              </button>
            ))}
          </div>

          <FieldGroup className="gap-5">
            {kind === "s3" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="s3-bucket">Bucket</FieldLabel>
                  <Input
                    id="s3-bucket"
                    required
                    className="font-mono"
                    value={s3.bucket}
                    onChange={set("bucket")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="s3-prefix">Prefix</FieldLabel>
                    <Input
                      id="s3-prefix"
                      className="font-mono"
                      placeholder="photos/"
                      value={s3.prefix}
                      onChange={set("prefix")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="s3-region">Region</FieldLabel>
                    <Input
                      id="s3-region"
                      className="font-mono"
                      value={s3.region}
                      onChange={set("region")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="s3-endpoint">Endpoint</FieldLabel>
                  <Input
                    id="s3-endpoint"
                    className="font-mono"
                    placeholder="https://"
                    value={s3.endpoint}
                    onChange={set("endpoint")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    Leave empty for AWS. Set it for S3-compatible storage like
                    MinIO or R2.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="s3-key">Access key ID</FieldLabel>
                  <Input
                    id="s3-key"
                    className="font-mono"
                    value={s3.access_key_id}
                    onChange={set("access_key_id")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="s3-secret">Secret access key</FieldLabel>
                  <Input
                    id="s3-secret"
                    type="password"
                    className="font-mono"
                    value={s3.secret_access_key}
                    onChange={set("secret_access_key")}
                    autoComplete="new-password"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="drive-folder">Folder URL</FieldLabel>
                  <Input
                    id="drive-folder"
                    type="url"
                    required
                    placeholder="https://drive.google.com/drive/folders/…"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <div
                  role="radiogroup"
                  aria-label="Folder sharing"
                  className="flex flex-col gap-2 text-sm"
                >
                  {(
                    [
                      ["public", "Anyone with the link"],
                      ["private", "Private, shared with a service account"],
                    ] as const
                  ).map(([v, label]) => (
                    <label
                      key={v}
                      className="flex cursor-pointer items-center gap-2.5"
                    >
                      <input
                        type="radio"
                        name="drive-access"
                        value={v}
                        checked={access === v}
                        onChange={() => {
                          setAccess(v);
                          setError("");
                        }}
                        className="size-4 accent-foreground"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {access === "public" ? (
                  serverKey ? (
                    <p className="text-sm text-muted-foreground">
                      The server's Google API key will be used to read the
                      folder.
                    </p>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="drive-key">
                        Google API key
                      </FieldLabel>
                      <Input
                        id="drive-key"
                        required
                        type="password"
                        className="font-mono"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        autoComplete="new-password"
                      />
                      <FieldDescription>
                        From a Google Cloud project with the Drive API enabled.
                        Or set GOOGLE_API_KEY on the server.
                      </FieldDescription>
                    </Field>
                  )
                ) : (
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel htmlFor="drive-creds">
                        Service account key
                      </FieldLabel>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        Upload JSON
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) setCreds(await f.text());
                          e.target.value = "";
                        }}
                      />
                    </div>
                    <Textarea
                      id="drive-creds"
                      required
                      rows={5}
                      placeholder='{"type": "service_account", …}'
                      className="max-h-48 min-h-28 font-mono text-xs"
                      value={creds}
                      onChange={(e) => setCreds(e.target.value)}
                      spellCheck={false}
                    />
                    <FieldDescription>
                      {email ? (
                        <>
                          Share the folder with{" "}
                          <span className="font-mono text-foreground [overflow-wrap:anywhere]">
                            {email}
                          </span>{" "}
                          so the app can read it.
                        </>
                      ) : (
                        "Share the folder with the service account's email (client_email in the key)."
                      )}
                    </FieldDescription>
                  </Field>
                )}
              </>
            )}
            <Field>
              <FieldLabel htmlFor="source-name">Name</FieldLabel>
              <Input
                id="source-name"
                placeholder={fallbackName || "Shown in search results"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </FieldGroup>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              Add source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
