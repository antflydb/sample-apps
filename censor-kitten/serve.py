#!/usr/bin/env python3
"""Serve local demo fixtures for Censor Kitten."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


CSS = "body{font:20px/1.5 Georgia,serif;margin:48px auto;max-width:660px}"
PAGES = {
    "/cheese": """<main><h1>Cheese</h1>
<p id="cheese">Cheese is a food made by coagulating milk. Aging changes its flavor and texture.</p>
<p id=\"stock\">To make a cheese soup, add the vegetables to a pot of broth and simmer gently.</p>
<p>Fresh ricotta has a soft, slightly grainy texture. Mature cheddar is firmer.</p></main>""",
    "/outbreak": """<main><h1 id="outbreak">The DRC’s Ebola outbreak remains out of control</h1>
<p id="outbreak-detail">A lack of treatments has made the outbreak <a id="source" href="/cheese">more fatal than ever</a>: Around half of those infected die.</p>
<p id="drama">My sister has stopped talking to me and is trying to turn the whole family against me.</p>
<p id="missing-dog">When I woke up, my dog was gone and the front door was wide open.</p>
<p id="reunited">Police have found the missing child safe and reunited her with her family.</p>
<p id="bread">The bread came out so well that the neighbors asked for the recipe.</p></main>""",
    "/tariffs": """<main><h1 id="tariffs">President announces new tariffs as trade dispute escalates</h1>
<p id="markets">Stocks tumbled as investors braced for a recession and widespread layoffs.</p>
<p id="plain">The newspaper is printed in several sizes for different editions.</p>
<p><a id="link" href="/cheese">President denounces opposition in parliament</a></p>
<input id="editor" value="Stock market crash"></main>
<script>setTimeout(() => {
 const div = document.createElement('div'); div.id = 'late';
 div.textContent = 'Missiles hit a crowded neighborhood as the war intensified and civilian casualties mounted.';
 document.querySelector('main').append(div);
 const neutral = document.createElement('p'); neutral.id = 'neutral';
 neutral.textContent = 'The cheesemonger stocks cheddar and brie on the shelves nearest the door.';
 document.querySelector('main').append(neutral);
}, 2500);</script>""",
    # Excerpts from Wikipedia, Salvadoran military intervention in Haiti (CC BY-SA 4.0).
    "/haiti": """<main>
<p id="intervention">Since 21 October 2026, El Salvador has been conducting a military intervention in Haiti following a gang ambush on 18 October that resulted in four Salvadoran aviation technicians of the Gang Suppression Force (GSF) being kidnapped. According to Salvadoran president Nayib Bukele, the intervention's primary objective is to rescue the four technicians, while threatening to "finish" the Haitian gangs if the technicians are not rescued alive.</p>
<p id="gang-conflict">A gang conflict has engulfed Haiti since 2020 with gangs taking control of much of the country, including most of the capital, Port-au-Prince. In 2023, the United Nations Security Council established the Multinational Security Support Mission (MSS, later reorganized as the GSF) to help the Haitian government combat gangs. El Salvador began supporting the GSF in January 2025 in non-combat roles and had at least 124 personnel in Haiti by October 2026. After Haitian gangs attacked and kidnapped the four Salvadoran technicians, Bukele announced the beginning of a military operation to rescue them.</p>
<p id="military-support">Haitian forces and the GSF are directly supporting the Salvadoran intervention. Furthermore, the United States, Colombia, and the Dominican Republic have provided El Salvador logistical support in transporting Salvadoran personnel and equipment to Haiti. Most Salvadoran troops in Haiti are operating independently from the GSF. Some analysts have accused the intervention of being an invasion, which both Bukele and Haitian prime minister Alix Didier Fils-Aimé deny. According to a CID Gallup opinion poll, the majority of Salvadorans approve of the intervention; Haitian civilians have protested in support of the intervention, with some protesting against it under threat of gang violence.</p>
<p id="tagline">the free encyclopedia that anyone can edit.</p>
<p id="cheese">Cheese is a food made by coagulating milk. Aging changes its flavor and texture.</p>
</main><footer><a href="https://en.wikipedia.org/wiki/Salvadoran_military_intervention_in_Haiti">Wikipedia, Salvadoran military intervention in Haiti</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></footer>""",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in PAGES:
            self.send_error(404)
            return
        body = (f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>{PAGES[self.path]}').encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 8765), Handler) as site:
        print("Open http://127.0.0.1:8765/tariffs, /outbreak, /haiti, or /cheese", flush=True)
        try:
            site.serve_forever()
        except KeyboardInterrupt:
            pass
