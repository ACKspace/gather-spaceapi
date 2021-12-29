const MAP_ID = "custom-entrance";
const X = 56;
const Y = 31;

const SWITCH_OFF = "https://ackspace.nl/spaceAPI/switch_off.png";

const HOST = '192.168.6.128/ws'
const OBJECT_ID = "karel";

import { EventObject } from "./EventObject";
import { WireObject } from "@gathertown/gather-game-client";


// Flags: module feature disable options

export class Carillon extends EventObject
{
    private ws: WebSocket;
    private notes: { [ key: string ]: number };

    constructor()
    {       
        super();
        const ws = this.ws = new WebSocket( `ws://${HOST}`);

        ws.onopen = function open()
        {
            //console.log('connected');
        };
        
        ws.onclose = function close()
        {
            //console.log('disconnected');
        };
        
        ws.onmessage = function incoming(data)
        {
            // Keyboard data
            //console.log( data );
        };

        this.notes = {
            "Note_D6": 86,
            "Note_E6": 88,
            "Note_F6": 90,
            "Note_G6": 91,
            "Note_A6": 93,
            "Note_B6": 95,
            "Note_C7": 96,
            "Note_D7": 98,
            "Note_E7": 100
        }
    }

    public init()
    {
        // Claim our objects (or have them created)
        for ( const id in this.notes )
            this.emit( "objectRegister", { source: this, room: MAP_ID, id: id, create: true } );
    }

    public getObject( id: string, _full: boolean): WireObject
    {
        const keys = Object.keys( this.notes );
        const index = keys.indexOf( id );
        if ( index === -1 )
            return {} as WireObject;

        // Create object and return it
        const object = {
            normal: SWITCH_OFF,
            highlighted: SWITCH_OFF,
            customState: "",
            previewMessage: `x: ${id.split( "_" )[ 1 ]}`,
            _tags: [], // currently needed for this request to complete
        };

        // Full object (create mode)?
        if ( _full )
        {
            Object.assign( object, {
                id: id,
                type: 5,
                x: X + index,
                y: Y,
                height: 1,
                width: 1,
                distThreshold: 0
            } );
        }

        return object as WireObject;
    }

    public setObject( _object: WireObject, initialCall: boolean ): void
    {
        // We're ignorant and don't do anything with the gather object that we get;
        // everything is MQTT-centric
    }

    public objectInteract( id: string ): boolean
    {
        this.ws.send( `${this.notes[ id ]}:1:50` );
        this.ws.send( `${this.notes[ id ]}:0:50` );

        // Interaction success 
        return true;
    }

    public destroy()
    {

        // Remove our objects
        for ( const id in this.notes )
        {
            this.emit( "objectRemove", { source: this, room: MAP_ID, id: id } );
        }
    }

}
