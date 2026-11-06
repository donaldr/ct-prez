# ct-prez

Animated web deck with shared sessions. Any path is a room: everyone who opens the same URL joins it. One person takes control and everyone else follows their slide, slideshow photo and hover state. The controller can set a total time; each slide gets an equal share, with slide and total countdowns that can be paused.

## Run locally

    npm install
    npx wrangler dev

Open http://localhost:8787/any-room-name in two windows.

## Deploy to Cloudflare

    npx wrangler login
    npx wrangler deploy

This prints your URL, like https://ct-deck.<your-subdomain>.workers.dev. Share https://ct-deck.<your-subdomain>.workers.dev/<room-name>.

## How it works

- `public/index.html`: the deck. The shared-session code is the last block in its script.
- `src/index.js`: a Cloudflare Worker that serves the deck and routes `/ws/<room>` to one Durable Object per room. The room keeps who has control, the controller's deck state and the timer, and relays them over WebSockets.
- Followers apply state (slide, slideshow photos, About me hover); they don't replay raw input. Late joiners get the current state on connect.
- Timers are stored as timestamps on the server; each browser computes the countdown itself.
- The notes window (press N) follows the deck in the same browser and shows the shared timer.
