# gather spacestate

This script adds a spacestate switch that controls the real space state
and also reflects the current spacestate.

This information is gathered [pun intended] from the [Gather API](https://gathertown.notion.site/Gather-Websocket-API-bf2d5d4526db412590c3579c36141063)

## setup

prerequisites
* have NodeJS (12 or above) and npm installed
* copy over `ministate_closed.png`, `ministate_open.png` and (most likely) `htaccess` (as `.htaccess`) from the `resources` directory to the webserver (inside the spaceeAPI directory)

run `npm install`

put your API keys in a file named `api-key.ts` like so:

```js
export const API_KEY = "your-api-key-here"; // not the hash, but the generated key via https://gather.town/apiKeys
export const SPACEAPI_KEY = "ackspace-spaceapi-key-here";

```

Note that `SPACE_ID` and `MAP_ID` are set to the ACKspace main "room"

## running

* for regular execution: `npm run start`
* verbose output: `npm run start -- --verbose`
* debug: `npm run debug`

Other arguments:
* `--verbose`: verbose output
* `--nonamechange`: don't update the non-player character's name
* `--nospaceapi`: disable spaceAPI "module"

Module specific arguments:
* `--nospacestate`: disable (spaceAPI) spacestate manipulation logic

## writing an "object" module

create a class file for your object:
```ts
import { EventObject } from "./EventObject";
import { WireObject } from "@gathertown/gather-game-client";

const MAP_ID = "custom-entrance"; // One of "custom-entrance", "buiten"
const ID = "MyGatherObjectID"

export class MyInteractionObject extends EventObject
{
    // Optional
    constructor()
    {
        super();

        // Setup defaults
        //...
    }

    public init(): void
    {
        // Claim our object (or have it created)
        this.emit( "objectRegister", { source: this, room: MAP_ID, id: ID, create: true } );

        // Initialize timers, etc.
        //...
    }

    public getObject( full: boolean): WireObject
    {
        // Return your (partial) object here.
        // See https://gathertown.notion.site/WIP-Gather-object-data-format-c24e9c491fbd40db83649591339614a1
        // NOTE: CORS

        
        // Mandatory fields for initial (full) call.
        // For updates, only the deltas are required
        return {
            id: "",                 // interaction reference id
            normal: "<URI>",        // image uri for normal state
            highlighted: "<URI>",   // image uri for object state when in range (and closest proximity)
            width: 1,               // the width of the image
            height: 1,              // the height of the image
            x: 20,                  // the x coordinate of the top left corner
            y: 20,                  // the y coordinate of the top left corner
            type: 5                 // 5 = websocket interaction object
        } as WireObject;
    }

    public setObject( object: WireObject, initialCall: boolean ): void
    {
        // Will be called with the object you registered for in two scenarios
        // * when it was still on the map before you ran this program (`initialCall` will be `true`)
        //   you can copy over the initial properties and go from there.
        // * every time the object is changed (by you or another process)
        //   note that if you change it (emit-ed "objectChanged"), there might be a delay
        //   before it arrives here
    }

    public objectInteract( id: string ): boolean
    {
        // This function will be called when a user interacts with this object.
        // All scripts (and in the future, all all `EventObject` instances) will
        // receive this event.

        // Optionally, you can indicate that the object has changed (i.e.: image, position, previewMessage)
        // it will be picked up by `index.ts` that will call `getObject` for its new shape and state
        this.emit( "objectChanged", { source: this, room: MAP_ID, id: ID } );

        // The return boolean is for future implementation to state "it has been handled; stop processing other instances.
        return false
    }

    // Optional
    public destroy(): void
    {
        // Cleanup timers, etc.
        //...
    }
}
```

In `index.ts` instantiate the new class: `const myInteractionObject = new MyInteractionObject();`, and register the event(s) at the initialization part:
```ts
myInteractionObject.on( "objectRegister", objectRegister );
myInteractionObject.on( "objectChanged", objectChanged );
myInteractionObject.on( "objectRemove", objectRemove );
```

## NOTE

Putting in your API key will make the bot join as you!
IF you want to be able to join as yourself and have the bot going at the same time,
just login with a different email and get an API key for that account, so you can use yours separately.

## TODO

* compartmentalize features that can be disabled with flags
