# gather spacestate

This script adds a spacestate switch that controls the real space state
it also reflects the current spacestate
A Gather NPC you can control via chat.

This information is gathered [pun intended] from the [Gather API](https://gathertown.notion.site/Gather-Websocket-API-bf2d5d4526db412590c3579c36141063)

## setup

prerequisites
* have NodeJS (12 or above) and npm installed
* copy over `ministate_closed.png`, `ministate_open.png` and (most likely) `htaccess` (as `.htaccess`) from the resource directory to the webserver (inside the spaceaAPI directory)

run `npm install`

put your API keys in a file named `api-key.ts` like so:

```js
export const API_KEY = "your-api-key-here"; // not the hash, but the generated key via https://gather.town/apiKeys
export const SPACEAPI_KEY = "ackspace-spaceapi-key-here";

```

replace the `SPACE_ID` in index.ts with your own spaceId
Note that `SPACE_ID` and `MAP_ID` are set to the ACKspace main "room"

## running

`npm run start`

## NOTE(!)

Putting in your API key will make the bot join as you!
You probably want to be able to join as yourself and have the bot going at the same time.
Just login with a different email and get an API key for that account, so you can use yours normally.
