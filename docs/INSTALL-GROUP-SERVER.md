# Installing KherveOS for a group (on a server)

This guide is for a lab, a class or a team: one computer runs KherveOS and the
server, and everyone opens it in a browser on the same network. Nobody installs
anything on their own machine except a web browser.

## What you need

- One server computer (macOS, Linux or Windows) on the group's network.
- **Node.js** 20.19 or newer (22 recommended) and **Python** 3.11 or newer.
- The KherveOS folder (a copy of this repository).
- **Internet on the server, once**, to install the dependencies.

Two ports are used: **4173** for the OS (what people open in their browser) and
**8787** for the server (accounts, Messages, Email, the games). Only 4173 needs to
be reachable from the other computers.

## 1. Install once, on the server

Run these from the KherveOS folder, one at a time:

```bash
npm install
```

```bash
npm run server:setup
```

```bash
npm run build
```

`npm run build` makes the production copy of the OS in `dist/`. Do not use
`npm run dev` for a group: it is the development server.

## 2. Start the server

Let the server answer on the network. On macOS or Linux:

```bash
KHERVEOS_HOST=0.0.0.0 npm run server
```

On Windows PowerShell:

```bash
$env:KHERVEOS_HOST="0.0.0.0"; npm run server
```

Keep this window open. Accounts, messages and the mailboxes are kept in
`server/data/`: back up that folder.

## 3. Serve the OS to the group

In a second terminal, from the same folder:

```bash
npm run preview -- --host
```

The preview server serves `dist/` on port 4173 and sends `/api` to the KherveOS
server on the same machine, so the two share one address.

Everyone then opens `http://<address-of-the-server>:4173`, for example
`http://192.168.1.20:4173`. Find the address with `ipconfig` (Windows) or
`ifconfig` / System Settings › Network (macOS).

To have it start by itself, run the two commands from a login item, a
`launchd` / `systemd` service, or a Windows scheduled task. KherveOS does not
ship one yet.

## 4. Each person

1. Open the address above in Chrome, Edge, Firefox or Safari.
2. Create an account (needed for Messages, Email, the games and notes sync).
3. Optional: add KherveOS to the Dock or Home screen from the browser menu
   (see the README, "Install it as an app").

## 5. Offline: what needs the internet

The OS, Files, Notepad, Terminal, KherveSheet, KherveTeX, the Browser and the
other apps run on the group's network with no internet. These parts still
download something from the internet the first time they are used, on each
browser:

| Part | Where it comes from | When |
|---|---|---|
| Python in the browser (Pyodide, about 10 MB, plus numpy, matplotlib… when imported) | cdn.jsdelivr.net | First time Python runs in a browser |
| Speech model (KherveNote) | cdn.jsdelivr.net | First time speech-to-text starts |

The browser keeps these in its cache, so after one run with internet they work
without it, **in that browser**. To prepare a group:

1. Open the OS on one computer with internet, in the browser the group will use.
2. Start Python once (open Terminal, type `print(1)`), and open a notebook in KherveBook.
   If people use KherveNote's speech-to-text, start it once too.
3. Repeat in each browser that will be used on the network.

Caveats: clearing the browser's data removes the cache, and a new browser profile
needs the internet again.

**A completely air-gapped server (no internet at all, ever) is not supported yet.**
It needs Pyodide and KaTeX to be served from the server itself, which is planned
but not done.

## 6. Updating

Stop the server and the preview (Ctrl+C), replace the folder with the new copy
(keep `server/data/`), then repeat steps 1 to 3. Users only need to reload the page.

## Troubleshooting

- **Other computers cannot connect:** the server must run with `KHERVEOS_HOST=0.0.0.0`,
  and the firewall must allow port 4173 (and 8787 if people connect to it directly).
- **"KherveOS server not running"** in the menu bar: the server window is closed or
  stopped; start it again (step 2).
- **Python says it could not start:** the browser has no internet and no cache yet;
  see section 5.
