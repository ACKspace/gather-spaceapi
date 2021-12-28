const MAP_ID = "custom-entrance";
const X = 56;
const Y = 28;

const OPEN = "https://ackspace.nl/spaceAPI/ministate_open.png";
const CLOSED = "https://ackspace.nl/spaceAPI/ministate_closed.png";
const HOST = '192.168.83.50'
const PORT = '1883'
const CLIENTID = "gather";
const OBJECT_ID = "decolight";
const MQTT_TOPIC = "zigbee2mqtt/outside/groundfloor/driveway/worklight";

import mqtt from 'mqtt';

import { MQTT_PASSWORD } from "./api-key";
import { EventObject } from "./EventObject";
import { WireObject } from "@gathertown/gather-game-client";


// Flags: module feature disable options


// Please note that the `customState` seemed to return lower case string; keep the enum lowercase for compatibility
enum SwitchState
{
    On = "on",
    Off = "off",
    Unknown = "unknown",
    Disabled = "disabled"
}


export class MqttBridge extends EventObject
{
    private state: SwitchState;
    private mqttClient: mqtt.MqttClient|undefined;
    private xColor: number;
    private yColor: number;

    constructor()
    {
        super();

        this.state = SwitchState.Unknown;
        // Pink-ish
        this.xColor = 0.32065217391304346;
        this.yColor = 0.15217391304347827;        
    }

    public init()
    {
        // Claim our object (or have it created)
        this.emit( "objectRegister", { source: this, room: MAP_ID, id: OBJECT_ID, create: true } );

        const client = this.mqttClient = mqtt.connect( `mqtt://${HOST}:${PORT}`, {
            clientId: CLIENTID,
            clean: true,
            connectTimeout: 4000,
            username: "gather",
            password: MQTT_PASSWORD,
            reconnectPeriod: 1000,
          } );

        client.on( "message", this.onMqttMessage.bind( this ) );

        client.on( "connect", () =>
        {
            console.log( "MQTT: Connected" )
            client.subscribe( [ MQTT_TOPIC ], () =>
            {
                console.log( `MQTT: Subscribe to topic "${MQTT_TOPIC}"` )
            } )
        } )
    }

    public getObject( id: string, _full: boolean): WireObject
    {
        console.log( "getobject:", this.state );

        // Create object and return it
        const image = this.switchStateToImage( this.state );
        const object = {
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
                id: OBJECT_ID,
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
        // We're ignorant and don't do anything with the gather object that we get;
        // everything is MQTT-centric
    }

    public objectInteract( id: string ): boolean
    {
        if ( id !== OBJECT_ID )
            console.warn( `Expect id to be "${OBJECT_ID}" only` );

        // We got an interact event: act accordingly (toggle the switch)
        const state = this.toggleLight( this.state );

		this.setRealState( state );

        // Interaction success, object changed 
        return true;
    }

    public destroy()
    {
        this.mqttClient?.end();

        // Remove our object
        this.emit( "objectRemove", { source: this, room: MAP_ID, id: OBJECT_ID } );
    }

    private onMqttMessage( topic: string, payload: Buffer ): void
    {
        const data = JSON.parse( payload.toString() );
        this.state = (data.state?.toLowerCase()) as SwitchState;

        console.log( "state", this.state );
        this.emit( "objectChanged", { source: this, room: MAP_ID, id: OBJECT_ID } );
        console.log( "emit done" );
    }

    private toggleLight( state:SwitchState ): SwitchState
    {
        switch ( state )
        {
            case SwitchState.On:
                // Random color
                this.xColor = Math.random();
                this.yColor = Math.random();
                return SwitchState.On; // Don't turn off!
            case SwitchState.Off:
                return SwitchState.On;

            // SwitchState.Disabled
            // SwitchState.Unknown
            default:
                console.warn( "Unexpected: inverting from unknown or disabled state" )
                return SwitchState.On;
        }
    }

    private switchStateToImage( state:SwitchState ): string
    {
        switch ( state )
        {
            case SwitchState.On:
                return OPEN;
            default:
                return CLOSED
        }
    }

    private switchStateToMessage( state:SwitchState ): string
    {
        switch ( state )
        {
            case SwitchState.On:
                return "On. press x to change color";
            case SwitchState.Off:
                return "Off. press x to switch on"
            case SwitchState.Unknown:
                return "unknown light state";
            case SwitchState.Disabled:
                return "Disabled (script not running)";
        }
    }

    private setRealState( state: SwitchState )
    {
        //{"brightness":254,"color":{"x":0.32065217391304346,"y":0.15217391304347827},"color_mode":"xy","linkquality":54,"power_on_behavior":"on","state":"OFF","update":{"state":"available"},"update_available":true}
        //{"state":"toggle","transition":0}
        const light = {
            state: state.toUpperCase(),
            color: {
                x: this.xColor,
                y: this.yColor
            }
        };

        // NOTE: we need to publish in `/set`: this is by Zigbee2Mqtt design
        this.mqttClient!.publish( MQTT_TOPIC + "/set", JSON.stringify( light ) );
    }
}
