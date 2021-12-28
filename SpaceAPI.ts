const MAP_ID = "custom-entrance";
const X = 30;
const Y = 25;

const OPEN_URL = "https://ackspace.nl/spaceAPI/ministate_open.png";
const CLOSED_URL = "https://ackspace.nl/spaceAPI/ministate_closed.png";
const SPACEAPI_URL = "https://ackspace.nl/spaceAPI/";

import { SPACEAPI_KEY } from "./api-key";
import https from 'https';
import { EventObject } from "./EventObject";
import { WireObject } from "@gathertown/gather-game-client";

// Flags: module feature disable options
const SPACESTATE = !process.argv.includes( "--nospacestate" );


const CLOSED_LOCKED = -2;
const OPEN_LOCKED = -1;
const CLOSED = 0;
const OPEN = 1;

// Please note that the `customState` seemed to return lower case string; keep the enum lowercase for compatibility
enum SwitchState
{
    On = "on",
    Off = "off",
    Unknown = "unknown",
    Disabled = "disabled"
}


export class Spacestate extends EventObject
{
    private state: SwitchState;
    private intervalTimer: NodeJS.Timer|undefined;

    constructor()
    {
        super();

        this.state = SwitchState.Unknown;
    }

    public init()
    {
        // Claim our object (or have it created)
        this.emit( "objectRegister", { source: this, room: MAP_ID, id: "spacestate", create: true } );

        // NOTE: we can only read the spaceAPI when our first `setObject` is called

        // Read real spaceAPI every 10 seconds
        this.intervalTimer = setInterval( async () =>
        {
            const state = await this.getSpaceAPI( );
            this.setVirtualSpacestate( state );
        }, 10000 );
    }

    public getObject( id: string, _full: boolean): WireObject
    {
        // Create object and return it
        const image = this.switchStateToImage( this.state );
        const object = {
            //id: "spacestate",
            //x: X,
            //y: Y,
            normal: image,
            highlighted: image,
            customState: this.state as string,
            previewMessage: this.switchStateToMessage( this.state ),
            _tags: [], // currently needed for this request to complete
        };

        // Full object (create mode)?
        if ( _full )
        {
            Object.assign( object, {
                id: "spacestate",
                type: 5,
                x: X,
                y: Y,
                height: 1,
                width: 1,
                distThreshold: 2
            } );
        }

        return object as WireObject;
    }

    public setObject( _object: WireObject, initialCall: boolean ): void
    {
        // update object (deduct space state)
        // NOTE: we're storing nothing except its state; all other properties are overridden at `getObject` 
        const state: SwitchState = _object.customState as SwitchState;

        console.log( `setObject: ${state} (${this.state})` );

        if ( this.state === state )
            return;

        // Unknown could mean initial call: update the state
        //if ( this.state === SwitchState.Unknown )
        if ( initialCall )
            this.initSpaceAPI();
    }

    public objectInteract( id: string ): boolean
    {
        if ( id !== "spacestate" )
            console.warn( "Expect id to be `spacestate` only" );

        // We got an interact event: act accordingly (toggle the spacestate)
        const state = this.invertState( this.state );

        // Set both states accordingly
		this.setVirtualSpacestate( state );
		this.setRealSpacestate( state );

        // Interaction success, object changed 
        return true;
    }

    public destroy()
    {
		// Stop the timer and update the switch first
        if ( this.intervalTimer )
			clearInterval( this.intervalTimer );

        this.setVirtualSpacestate( SwitchState.Disabled );

		// Trigger faux spacestate to release override
		// assume the real switch is closed, 
        if ( SPACESTATE )
		    https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=1` );
    }

    private async initSpaceAPI( ): Promise<void>
    {
        console.log( "init spaceAPI" );

        const state = await this.getSpaceAPI( );
        this.setVirtualSpacestate( state );
    }

    private invertState( state:SwitchState ): SwitchState
    {
        switch ( state )
        {
            case SwitchState.On:
                return SwitchState.Off;
            case SwitchState.Off:
                return SwitchState.On;

            // SwitchState.Disabled
            // SwitchState.Unknown
            default:
                console.warn( "Unexpected: inverting from unknown or disabled state" )
                return SwitchState.On;
        }
    }

    private switchStateToTernary( state:SwitchState ):boolean|null
    {
        switch ( state )
        {
            case SwitchState.On:
                return true;
            case SwitchState.Off:
                return false;

            // SwitchState.Disabled
            // SwitchState.Unknown
            default:
                return null;
        }
    }

    private switchStateToImage( state:SwitchState ): string
    {
        switch ( state )
        {
            case SwitchState.On:
                return OPEN_URL;
            default:
                return CLOSED_URL;
        }
    }

    private switchStateToMessage( state:SwitchState ): string
    {
        switch ( state )
        {
            case SwitchState.On:
                return "Open! press x to close the space";
            case SwitchState.Off:
                return "Closed. press x to open the space"
            case SwitchState.Unknown:
                return "unknown state";
            case SwitchState.Disabled:
                return "Disabled (script not running)";
        }
    }

    private ternaryToSwitchState( state:boolean|null ): SwitchState
    {
        switch ( state )
        {
            case true:
                return SwitchState.On;
            case false:
                return SwitchState.Off;
            default:
                return SwitchState.Unknown;
        }
    }

    private setVirtualSpacestate( state:SwitchState )
    {
        console.log( `setVirtualSpacestate: ${state} (${this.state})`)
        if ( this.state === state )
            return;

        this.state = state;
        this.emit( "objectChanged", { source: this, room: MAP_ID, id: "spacestate" } );
    }

    private setRealSpacestate( state: SwitchState )
    {
        console.log( `setting real state (forced): ${state}`);

        // NOTE: the override mechanism only works when the current spacestate has the opposite state:
        // i.e.: when the switch emits "on" every 20 seconds, setting the override to off will lock it in its "off" position.
        //       after the switch has been turned to its equal (non-locked) state (off), the lock will "release" and normal operation can continue
        //       This is also the case when the state was locked to either value: locked off needs an on-trigger before it can be locked at its on position 

        // Since we really don't know what state it is (on, off, forced-on, forced-off), we emit a faux inverse to release any lock and lock it in place again with the desired state.

        const spacestate = this.switchStateToTernary( state );
       
        if ( SPACESTATE )
        {
            // Trigger faux spacestate to enable override
            https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${spacestate ? CLOSED : OPEN}`, (res) =>
            {
                if ( res.statusCode === 200 )
                    https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${spacestate ? OPEN_LOCKED : CLOSED_LOCKED}` );
            } ).on('error', ( e ) => {
                console.error( e );
            } );
        }
    }

    private async getSpaceAPI(): Promise<SwitchState>
    {
        return new Promise((resolve) => {
            https.get(SPACEAPI_URL,(res) => {
                let body = "";

                res.on("data", (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {
                    try {
                        const json = JSON.parse( body );
                        resolve( this.ternaryToSwitchState( json.state.open ) );
                    } catch ( error: any )
                    {
                        console.error( error.message );
                        resolve( SwitchState.Unknown );
                    };
                });

            }).on("error", ( error: Error ) => {
                console.error( error.message );
                resolve( SwitchState.Unknown );
            });
        } );
    }
}
