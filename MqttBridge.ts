const MAP_ID = "custom-entrance";
const X = 56;
const Y = 28;

const OPEN = "https://ackspace.nl/spaceAPI/ministate_open.png";
const CLOSED = "https://ackspace.nl/spaceAPI/ministate_closed.png";

const SWITCH_OFF = "https://ackspace.nl/spaceAPI/switch_off.png";
const SWITCH_ON = "https://ackspace.nl/spaceAPI/switch_on.png";

const SWITCH_BLACK = "https://ackspace.nl/spaceAPI/switch_black.png";
const SWITCH_WHITE = "https://ackspace.nl/spaceAPI/switch_white.png";
const SWITCH_RED = "https://ackspace.nl/spaceAPI/switch_red.png";
const SWITCH_ORANGE = "https://ackspace.nl/spaceAPI/switch_orange.png";
const SWITCH_YELLOW = "https://ackspace.nl/spaceAPI/switch_yellow.png";
const SWITCH_GREEN = "https://ackspace.nl/spaceAPI/switch_green.png";
const SWITCH_CYAN = "https://ackspace.nl/spaceAPI/switch_cyan.png";
const SWITCH_BLUE = "https://ackspace.nl/spaceAPI/switch_blue.png";
const SWITCH_PURPLE = "https://ackspace.nl/spaceAPI/switch_purple.png";
const SWITCH_PINK = "https://ackspace.nl/spaceAPI/switch_pink.png";

const COLORS = [
    { img: SWITCH_BLACK,    x: 0.1,                 y: 0.1,                 msg: "Off. Press x to switch on" },
    { img: SWITCH_WHITE,    x: 0.3125,              y: 0.32894736842105265, msg: "White. Press x to change color" },
    { img: SWITCH_RED,      x: 0.6307692307692307,  y: 0.3230769230769231,  msg: "Red. Press x to change color" },
    { img: SWITCH_ORANGE,   x: 0.49107142857142855, y: 0.42857142857142855, msg: "Orange. Press x to change color" },
    { img: SWITCH_YELLOW,   x: 0.41847826086956524, y: 0.5054347826086957,  msg: "Yellow. Press x to change color" },
    { img: SWITCH_GREEN,    x: 0.30578512396694213, y: 0.5950413223140496,  msg: "Green. Press x to change color" },
    { img: SWITCH_CYAN,     x: 0.225,               y: 0.32916666666666666, msg: "Cyan. Press x to change color" },
    { img: SWITCH_BLUE,     x: 0.14912280701754385, y: 0.06140350877192982, msg: "Blue. Press x to change color" },
    { img: SWITCH_PURPLE,   x: 0.22758620689655173, y: 0.1103448275862069,  msg: "Purple. Press x to change color" },
    { img: SWITCH_PINK,     x: 0.34146341463414637, y: 0.17073170731707318, msg: "Pink. Press x to witch off" }
];

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


export class MqttBridge extends EventObject
{
    private colorIndex: number;
    private mqttClient: mqtt.MqttClient|undefined;

    constructor()
    {
        super();

        this.colorIndex = 0;
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
        // Create object and return it
        const image = COLORS[ this.colorIndex ].img;
        const msg = COLORS[ this.colorIndex ].msg;
        const object = {
            normal: image,
            highlighted: image,
            customState: `${this.colorIndex}`,
            previewMessage: msg,
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

        // We got an interact event: act accordingly (change the light)
        const index = this.changeLight( this.colorIndex );

		this.setRealState( index );

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
        // TODO: determine `this.colorIndex`
        //this.colorIndex = ...

        this.emit( "objectChanged", { source: this, room: MAP_ID, id: OBJECT_ID } );
    }

    private changeLight( index: number ): number
    {
        if ( index < 0 )
            return this.colorIndex = COLORS.length - 1;
        else if ( index >= COLORS.length - 1 )
            return this.colorIndex = 0;
        else
            return this.colorIndex = index + 1;
    }

    private setRealState( index: number )
    {
        //{"brightness":254,"color":{"x":0.32065217391304346,"y":0.15217391304347827},"color_mode":"xy","linkquality":54,"power_on_behavior":"on","state":"OFF","update":{"state":"available"},"update_available":true}
        //{"state":"toggle","transition":0}

        const state = index ? "ON": "OFF";
        const light = {
            state: state,
            color: {
                x: COLORS[ index ].x,
                y: COLORS[ index ].y
            }
        };

        // NOTE: we need to publish in `/set`: this is by Zigbee2Mqtt design
        this.mqttClient!.publish( MQTT_TOPIC + "/set", JSON.stringify( light ) );
    }
}
