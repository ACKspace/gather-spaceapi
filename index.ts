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

const game = new Game( () => Promise.resolve( { apiKey: API_KEY } ) );
game.connect( SPACE_ID );
//game.subscribeToConnection((connected) => console.log("connected?", connected));

let gather_map_objects: { [key: number]: WireObject } = {};
let switchId:number|null = null;

function setVirtualSpacestate( state:boolean|null )
{
	if ( switchId === null )
	{
		console.log( "no switch found" );
		return;
	}

	const obj = gather_map_objects[ switchId ];
	const oldstate = obj.customState === "on";

	if ( oldstate === state )
		return;	

	game.engine.sendAction({
		$case: "mapSetObjects",
		mapSetObjects: {
			mapId: MAP_ID,
			objects: {
				[switchId]: {
					x: X,
					y: Y,
					normal: state ? OPEN : CLOSED,
					highlighted: state ? OPEN : CLOSED,
					customState: state ? "on" : "off",
					previewMessage: state ? "Open! press x to close the space" : "Closed. press x to open the space",
					_tags: [], // currently needed for this request to complete
				},
			},
		},
	});

}

function setRealSpacestate( state:boolean )
{
	console.log( `setting real state (forced): ${state}`)
	// -2:closed
	// -1:open
	// 0: closed
	// 1: open

	// Trigger faux spacestate to enable override
	https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${state?0:1}` );
	// Override space state
	https.get( `${SPACEAPI_URL}?key=${SPACEAPI_KEY}&update=state&state=${state?-1:-2}` );
}

async function getRealSpacestate(): Promise<boolean|null>
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
					// do something with JSON
					resolve( json.state.open );
				} catch ( error: any )
				{
					console.error( error.message );
					resolve( null );
				};
			});

		}).on("error", (error) => {
			console.error(error.message);
			resolve( null );
		});
	} );
}

// Read real spacestate every 10 seconds
setInterval( async () => {
	const state = await getRealSpacestate( );
	console.log( `spaceAPI spacestate: ${state}` );
	setVirtualSpacestate( state );
}, 10000 )

// Object interaction
game.subscribeToEvent("playerInteracts", (data, _context) => {
	const objId = parseInt(data.playerInteracts.objId);
	const obj = gather_map_objects[ objId ];

	if ( "customState" in obj && obj.id === `${switchId}` ) 
	{
		const state = obj.customState === "on";
		setVirtualSpacestate( !state );
		setRealSpacestate( !state );
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
				customState: "off",
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
	}

} );

// initialize
setTimeout( () => {
	console.log("initializing.. press ctrl+c to stop this script");
	game.engine.sendAction({
		$case: "setName",
		setName: {
			name: "NPC:spacestate",
		},
	});
}, 2000 ); // wait two seconds before setting these just to give the game a chance to init


// Press ctrl+c to exit the script (and cleanup)
process.on('SIGINT', function()
{
    console.log("Caught interrupt signal; cleaning up");

	// Update the switch first
	if ( switchId !== null )
	{
		game.engine.sendAction({
			$case: "mapSetObjects",
			mapSetObjects: {
				mapId: MAP_ID,
				objects: {
					[switchId]: {
						x: X,
						y: Y,
						width: 1,
						normal: CLOSED,
						highlighted: CLOSED,
						customState: "off",
						previewMessage: "Disabled (script not running)",
						_tags: [], // smh we're going to hopefully get rid of this soon but for now you just have to include it with setObject actions, sorry
					},
				},
			},
		});
	}

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