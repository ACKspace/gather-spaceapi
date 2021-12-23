import { API_KEY, SPACEAPI_KEY } from "./api-key";
import { Game, WireObject, MoveDirection } from "@gathertown/gather-game-client";

import https from 'https';

global.WebSocket = require("isomorphic-ws");

const SPACE_ID = "iVeuxmC1wz9bpz3p\\ACKspace";
const MAP_ID = "custom-entrance";
const X = 30;
const Y = 25;

const OPEN = "https://ackspace.nl/spaceAPI/ministate_open.png";
const CLOSED = "https://ackspace.nl/spaceAPI/ministate_closed.png";
const SPACEAPI_URL = "https://ackspace.nl/spaceAPI/";

const DEBUG = process.argv.includes("DEBUG");
const VERBOSE = process.argv.includes("VERBOSE");

const game = new Game( () => Promise.resolve( { apiKey: API_KEY } ) );

game.connect( SPACE_ID );
game.subscribeToConnection( (connected) => {
	if ( VERBOSE )
		console.log( "connected?", connected )
} );

let gather_map_objects: { [key: number]: WireObject } = {};
let switchId:number|null = null;

function findObject( objId:string ):WireObject|null
{
	// I guess this is a sparse array,
	// so we have the downsides of an object
	// and the downsides of an array
	const key = Object.keys( gather_map_objects ).find( ( key ) => {
		const currentObject = gather_map_objects[ parseInt( key ) ];

		if ( key === objId )
			console.warn( "found index as id, this is unexpected" );

		return currentObject.id === objId;
	} ) || null;

	if ( key !== null )
		return gather_map_objects[ parseInt( key ) ];
		
	// Not found
	if ( VERBOSE )
	{
		console.log( `id not found: ${objId}` );
		if ( DEBUG )
			console.log( "objects", gather_map_objects );
	}

	return null;
}

// Please note that the `customState` seemed to return lower case string; keep the enum lowercase for compatibility
enum SwitchState
{
	On = "on",
	Off = "off",
	Unknown = "unknown",
	Disabled = "disabled"
}

function invertState( state:SwitchState ): SwitchState
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

function switchStateToTernary( state:SwitchState ):boolean|null
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

function switchStateToImage( state:SwitchState ): string
{
	switch ( state )
	{
		case SwitchState.On:
			return OPEN;
		default:
			return CLOSED
	}
}

function switchStateToMessage( state:SwitchState ): string
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

function ternaryToSwitchState( state:boolean|null ): SwitchState
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

function setVirtualSpacestate( state:SwitchState )
{
	if ( switchId === null )
	{
		console.log( "no switch found" );
		return;
	}

	const obj = gather_map_objects[ switchId ];
	const oldstate = obj.customState as SwitchState;

	if ( oldstate === state )
		return;

	if ( VERBOSE )
		console.log( `set virtual spacestate (oldstate): ${state} (${oldstate})` );

	const image = switchStateToImage( state );

	game.engine.sendAction({
		$case: "mapSetObjects",
		mapSetObjects: {
			mapId: MAP_ID,
			objects: {
				[switchId]: {
					x: X,
					y: Y,
					normal: image,
					highlighted: image,
					customState: state as string,
					previewMessage: switchStateToMessage( state ),
					id: "spacestate",
					_tags: [], // currently needed for this request to complete
				},
			},
		},
	});

}

function setRealSpacestate( state: SwitchState )
{
	console.log( `setting real state (forced): ${state}`)

	// -2:closed
	// -1:open
	// 0: closed
	// 1: open
	const spacestate = switchStateToTernary( state );

	// Trigger faux spacestate to enable override
	https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${spacestate?0:1}` );
	// Override space state
	https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${spacestate?-1:-2}` );
}

async function getSpaceAPIstate(): Promise<SwitchState>
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
					if ( VERBOSE )
						console.log( `SpaceAPI spacestate: ${json.state.open}`)
					resolve( ternaryToSwitchState( json.state.open ) );
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

// Read real spacestate every 10 seconds
const intervalTimer = setInterval( async () => {
	const state = await getSpaceAPIstate( );
	setVirtualSpacestate( state );
}, 10000 )

// Object interaction
game.subscribeToEvent("playerInteracts", (data, _context) => {
	const objId = data.playerInteracts.objId;
	const obj = findObject( objId );

	if ( VERBOSE )
	{
		console.log( "interact event, id:", objId );
		// invalid id?
		if ( !objId )
		{
			console.log( "data", data );
			console.log( "playerInteracts", data.playerInteracts );
		}
	}

	// Note that the object id currently has no value to check for
	if ( obj && ( "customState" in obj ) ) 
	{
		const state = invertState( obj.customState as SwitchState );
		setVirtualSpacestate( state );
		setRealSpacestate( state );
	}
	else if ( VERBOSE )
	{
		console.log( "object has no customState", obj );
	}
});

// map-object data
game.subscribeToEvent("mapSetObjects", (data, _context) =>
{
	if (data.mapSetObjects.mapId === MAP_ID )
	{
		gather_map_objects = data.mapSetObjects.objects;

		let key:any;
		for ( key in gather_map_objects )
		{
			const obj = gather_map_objects[ key ];
			if ( "customState" in obj )
				switchId = key;

			// Show all objects in DEBUG mode
			if ( DEBUG && VERBOSE )
			{
				console.log( obj );
				console.log( "=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=" );
			}

		}

		if ( !switchId )
		{
			console.log( "injecting spacestate switch" );

			switchId = key + 1;
			const spacestate = {
				id: `${switchId}`,
				height: 1,
				width: 1,
				distThreshold: 2,
				x: X,
				y: Y,
				type: 5,
				previewMessage: "press x to toggle space state",
				normal: CLOSED,
				highlighted: CLOSED,
				customState: SwitchState.Unknown,
				_tags: [], // currently needed for this request to complete
			};
			gather_map_objects[ switchId! ] = spacestate;


			game.engine.sendAction({
				$case: "mapSetObjects",
				mapSetObjects: {
					mapId: MAP_ID,
					objects: data.mapSetObjects.objects
				},
			});
		}
		else
		{
			if ( VERBOSE )
				console.log( `switch id found (state): ${switchId} (${gather_map_objects[switchId].customState})` );
			if ( DEBUG )
				console.log( gather_map_objects[switchId] );

		}
	}

} );

// initialize
setTimeout( () => {
	if ( DEBUG )
		console.log( "DEBUG mode");
	if ( VERBOSE )
		console.log( "VERBOSE mode");

	console.log("initializing.. press ctrl+c to stop this script");
	game.engine.sendAction({
		$case: "setName",
		setName: {
			name: "NPC:spacestate",
		},
	});
	// Set unknown spacestate
	setVirtualSpacestate( SwitchState.Unknown );
}, 2000 ); // wait two seconds before setting these just to give the game a chance to init


// Press ctrl+c to exit the script (and cleanup)
process.on('SIGINT', function()
{
    console.log("Caught interrupt signal; cleaning up");
	// Stop the timer and update the switch first
	clearInterval( intervalTimer );
	setVirtualSpacestate( SwitchState.Disabled );


	game.engine.sendAction({
		$case: "setName",
		setName: {
			name: "xopr",
		},
	});

	// Trigger faux spacestate to release override
	// assume the real switch is closed, 
	https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=1` );	

	process.exit();
});