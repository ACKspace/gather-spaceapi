const SPACE_ID = "iVeuxmC1wz9bpz3p\\ACKspace";

import { API_KEY } from "./api-key";
import { Game, WireObject } from "@gathertown/gather-game-client";

import { EventObject } from "./EventObject";
import { Spacestate } from "./SpaceAPI";
import { MqttBridge } from "./MqttBridge";

global.WebSocket = require("isomorphic-ws");

// Flags
const DEBUG = process.argv.includes( "--debug" );				// debug setting (object printing and feature testing)
const VERBOSE = process.argv.includes( "--verbose" );			// verbose console output
// Flags: feature disable options
const READONLY = process.argv.includes( "--readonly" );			// "readonly" gather connection
const SPACEAPI = !process.argv.includes( "--nospaceapi" );  	// don't initialize SpaceAPI module
const CHANGE_NAME = !process.argv.includes( "--nonamechange" ); // don't touch our nickname
const MQTT = !process.argv.includes( "--nomqtt" );

const game = new Game( () => Promise.resolve( { apiKey: API_KEY } ) );
const spacestate = new Spacestate();
const mqttBridge = new MqttBridge();

// Program initialization
( () => {
	console.log( new Date(), "init" );

	if ( DEBUG )
		console.log( "DEBUG mode");
	if ( VERBOSE )
		console.log( "VERBOSE mode");

	console.log("initializing.. press ctrl+c to stop this script");

	if ( SPACEAPI )
	{
		// Register events
		spacestate.on( "objectRegister", objectRegister );
		spacestate.on( "objectChanged", objectChanged );
		spacestate.on( "objectRemove", objectRemove );
	}

	if ( MQTT )
	{
		mqttBridge.on( "objectRegister", objectRegister );
		mqttBridge.on( "objectChanged", objectChanged );
		mqttBridge.on( "objectRemove", objectRemove );

	}

} )();

game.connect( SPACE_ID );
game.subscribeToConnection( (connected) => {
	if ( VERBOSE )
		console.log( `connected: ${connected}` );

	// TODO: Generate the name from the active modules (or set a generic name)
	if ( CHANGE_NAME )
	{
		if ( READONLY )
		{
			console.log( "readonly Gather:setName", "NPC:spacestate" );
		}
		else
		{
			if ( VERBOSE )
				console.log( "setting name" );
			game.engine.sendAction( {
				$case: "setName",
				setName: {
					name: "NPC:spacestate",
				},
			} );
		}
	}

	if ( SPACEAPI )
		spacestate.init();

	if ( MQTT )
		mqttBridge.init();


} );

interface RoomObjects { [key: number]: WireObject }

const roomObjects: { [room: string]: RoomObjects } = {};
const mutexRooms: { [room: string]: Promise<boolean> } = {};
const mutexResolvers: { [room: string]: Function } = {};
const subscribers: { [id: string]: { subscriber: EventObject, key: number } } = {};

async function getMutex( _room: string, _timeout: number|undefined ): Promise<boolean>
{
	if ( _room in mutexRooms )
	{
		// Resolved, return true
		return true;
	}
	else
	{
		const mutexResolver = new Promise<boolean>( resolve =>
		{
			// Assign resolver function
			mutexResolvers[ _room ] = resolve;
		} );

		// Unresolved, return a promise that can be resolved by the data event handler
		if ( _timeout )
		{
			// Race condition between mutex resolver and timout
			mutexRooms[ _room ] = Promise.race( [ mutexResolver, timeout( _timeout, false ) ] );
		}
		else
		{
			mutexRooms[ _room ] = mutexResolver;
		}

		return mutexRooms[ _room ];
	}
}

/** This function tries to return room objects within 5 seconds (or earlier)
 *  it tries to read a mutex which is already "released" or set (together with a resolver)
 *  for the `mapSetObjects` event to resolve after it has assigned its (new) data
 */
async function getRoomObjects( _room: string ): Promise<RoomObjects>
{
	const hasRoom = await getMutex( _room, 5000 );

	if ( hasRoom )
		return roomObjects[ _room ];
	else
		return {} as RoomObjects;
}


function getNewKey( _roomObjects: RoomObjects ):number
{
	let newKey = -1;
	Object.keys( _roomObjects ).forEach( strkey =>
	{
		const key = parseInt( strkey );
		if ( key > newKey )
			newKey = key;
	} );
	return ++newKey;
}

function getObjectKey( _roomObjects: RoomObjects, _objId: string ):number|null
{
	// I guess the objects are a sparse array,
	// so we have the downsides of an object
	// and the downsides of an array
	const key = Object.keys( _roomObjects ).find( ( key ) => {
		const currentObject = _roomObjects[ parseInt( key ) ];

		if ( key === _objId )
			console.warn( "found index as id, this is unexpected" );

		return currentObject.id === _objId;
	} ) || null;

	if ( VERBOSE )
	{
		if ( key )
		{
			console.log( `found key ${key} for id ${_objId}` );
			if ( DEBUG )
				console.log( "objects", _roomObjects[ parseInt( key ) ] );
		}
		else
		{
			console.log( `id not found: "${_objId}"` );
		}
	}

	return key ? parseInt( key ) : null;
}

function findObject( _roomObjects: RoomObjects, _objId: string ):WireObject|null
{
	const key = getObjectKey( _roomObjects, _objId );
	return key ? _roomObjects[ key ] : null;
}

// Object interaction
game.subscribeToEvent( "playerInteracts", (data, _context) => {
	const id = data.playerInteracts.objId;

	if ( VERBOSE )
		console.log( `interact: ${id}` );

	// Lookup object reference and interact
	if ( subscribers[ id ] )
		subscribers[ id ].subscriber.objectInteract( id );
	else
		console.warn( `Interact: no subscription for id ${id}` )
} );

// Object data from room (map)
game.subscribeToEvent( "mapSetObjects", (data, _context) =>
{
	// Lookup object references (per MAP_ID) and delegate
	const room = data.mapSetObjects.mapId;

	// Update room data
	const roomlength = roomObjects[ room ] && Object.keys(roomObjects[ room ]).length;
	const initialCall = !roomObjects[ room ];

	roomObjects[ room ] = Object.assign( {}, roomObjects[ room ], data.mapSetObjects.objects );
	if ( VERBOSE )
		console.log( `TODO: object count (${room} / ${roomlength}): ${Object.keys(data.mapSetObjects.objects).length}` );

	if ( data.mapSetObjects.mapId in mutexResolvers )
	{
		if ( VERBOSE )
			console.log( `resolving mutex for room ${room}` )

		mutexResolvers[ room ]( true );
	}
	else
	{
		if ( VERBOSE )
			console.log( `dummy resolve mutex for room ${room}` )

		mutexResolvers[ room ] = () => { console.log( "dummy mutex resolve" ) };
		mutexRooms[ room ] = Promise.resolve( true );
	}

	// Iterate all objects and handle object subscription
	Object.keys( roomObjects[ room ] ).find( ( key ) =>
	{
		const currentObject = roomObjects[ room ][ parseInt( key ) ];
		if ( currentObject.id && subscribers[ currentObject.id ] )
		{
			if ( VERBOSE )
				console.log( `calling setObject for identifier ${currentObject.id}` );
			subscribers[ currentObject.id ].subscriber.setObject( currentObject, initialCall );
		}
	} );

} );

/**
 * timeout promise
 * @param delay amount of milliseconds to wait before timeout
 * @param data the data of which the timeout will resolve to (for example `false` for comnnected timeout)
 * @returns a promise that will resolve to `data` provided as parameter
 */
async function timeout<T>( delay:number, data:T ): Promise<T>
{
	return new Promise( (resolve) =>
	{
		setTimeout( resolve.bind( null, data ), delay );
	} );
}

async function objectRegister( data: { source: EventObject, room: string, id: string, create: boolean } )
{
	// Register reference to this object from caller
	console.log( `Object register for "${data.id}" (${data.create}) at ${data.room}` )

	const objects = await getRoomObjects( data.room );
	let key = getObjectKey( objects, data.id );

	if ( key !== null )
	{
		data.source.setObject( objects[ key ], true );
	}
	else if ( data.create )
	{
		// Not found and source wants it? Let it create one for us
		key = getNewKey( objects );

		// NOTE: Trigger object change after `source` is a valid subscriber
	}

	// Store reference (currently only one per object)
	// NOTE: if the object appears later, the source will not receive updates
	if ( key )
	{
		subscribers[ data.id ] = { subscriber: data.source, key: key };

		// Trigger object change which fetches the object from `source` and updates the room
		if ( data.create )
			objectChanged( data );
	}
}

function objectChanged( data: { source: EventObject, room: string, id: string, create: boolean } )
{
	// Register reference to this object from caller
	if ( VERBOSE )
		console.log( "object changed", data.room, data.id )

	// TODO: /!\ getMutex will most likely not synchronize objectRegister reliably

	// Verify subscription
	if ( !subscribers[ data.id ] )
	{
		console.warn( `Changed: no subscription for id "${data.id}"` );
		return;
	}

	const subscription = subscribers[ data.id ];

	if ( subscription.subscriber !== data.source )
	{
		console.warn( `Changed: source not subscribed on id "${data.id}"` );
		return;
	}

	const object = data.source.getObject( data.create );

	if ( VERBOSE )
		console.log( `set room object for key ${subscription.key}:`, object );

	// Update gather
	if ( !READONLY )
	{
		// Sanity check
		if ( object )
		{
			game.engine.sendAction(
			{
				$case: "mapSetObjects",
				mapSetObjects: {
					mapId: data.room,
					objects: {
						[ subscription.key ]: object
					},
				},
			} );
		}
	}
	else
	{
		console.log( "readonly Gather:mapSetObjects", data.room, subscription.key, object );
	}

}

function objectRemove( data: { source: EventObject, room: string, id: string } )
{
	// Verify subscription
	if ( !subscribers[ data.id ] )
	{
		console.warn( `Remove: no subscription for id ${data.id}` );
		return;
	}

	const subscription = subscribers[ data.id ];

	if ( subscription.subscriber !== data.source )
	{
		console.warn( `Remove: source not subscribed on id ${data.id}` );
		return;
	}

	// TODO: verify remove object
	console.log( "TODO: verify remove object (room,id,key)", data.room, data.id, subscription.key );

	// Update gather
	if ( !READONLY )
	{
		game.engine.sendAction(
		{
			$case: "mapDeleteObject",
			mapDeleteObject: {
				mapId: data.room,
				key: subscription.key
			},
		} );
	}
	else
	{
		console.log( "readonly Gather:mapDeleteObject", data.room, subscription.key );
	}
}

// Press ctrl+c to exit the script (and cleanup)
process.on( "SIGINT", function()
{
    console.log("Caught interrupt signal; cleaning up");

	spacestate.destroy();
	mqttBridge.destroy();

	if ( CHANGE_NAME )
	{
		if ( READONLY )
		{
			console.log( "readonly Gather:setName", "xopr" );
		}
		else
		{
			if ( VERBOSE )
				console.log( "restoring name" );

			// Restore name
			game.engine.sendAction( {
				$case: "setName",
				setName: {
					name: "xopr",
				},
			} );
		}
	}

	process.exit();
} );



/*
enum ServerClientEvent
{
	Info = "info",
	Warn = "warn",
	Error = "error",
	Ready = "ready",
	ServerHeartbeat = "serverHeartbeat",
	PlayerMoves = "playerMoves",
	PlayerSetsStatus = "playerSetsStatus",
	PlayerSpotlights = "playerSpotlights",
	PlayerRings = "playerRings",
	PlayerChats = "playerChats",
	PlayerInteracts = "playerInteracts",
	PlayerGhosts = "playerGhosts",
	PlayerLeavesWhisper = "playerLeavesWhisper", // deprected?
	PlayerActivelySpeaks = "playerActivelySpeaks",
	PlayerSetsEmote = "playerSetsEmote",
	PlayerSetsWorkCondition = "playerSetsWorkCondition",
	PlayerSetsName = "playerSetsName",
	PlayerSetsTextStatus = "playerSetsTextStatus",
	PlayerSetsEmojiStatus = "playerSetsEmojiStatus",
	PlayerSetsAffiliation = "playerSetsAffiliation",
	PlayerExits = "playerExits",
	PlayerSetsSprite = "playerSetsSprite",
	PlayerSetsOutfitString = "playerSetsOutfitString",
	PlayerSetsIsSignedIn = "playerSetsIsSignedIn",
	SpaceOverwrites = "spaceOverwrites",
	SpaceIsClosed = "spaceIsClosed",
	PlayerEntersPortal = "playerEntersPortal",
	SpaceSetsIdMapping = "spaceSetsIdMapping",
	PlayerSetsLastActive = "playerSetsLastActive", // experimental
	PlayerShootsConfetti = "playerShootsConfetti", // experimental
	PlayerSetsEventStatus = "playerSetsEventStatus", // experimental
	PlayerSetsInConversation = "playerSetsInConversation", // experimental
	PlayerSetsCurrentDesk = "playerSetsCurrentDesk", // experimental
	PlayerSetsCurrentArea = "playerSetsCurrentArea", // experimental
	PlayerSetsImagePointer = "playerSetsImagePointer",
	CookieFound = "cookieFound", // experimental
	PlayerEntersWhisperV2 = "playerEntersWhisperV2",
	PlayerSetsGoKartId = "playerSetsGoKartId", // experimental
	MapSetDimensions = "mapSetDimensions",
	MapSetCollisions = "mapSetCollisions",
	MapSetBackgroundImagePath = "mapSetBackgroundImagePath",
	MapSetForegroundImagePath = "mapSetForegroundImagePath",
	MapSetSprites = "mapSetSprites",
	MapSetSpaces = "mapSetSpaces",
	MapSetSpawns = "mapSetSpawns",
	MapSetPortals = "mapSetPortals",
	MapSetAnnouncer = "mapSetAnnouncer",
	MapSetAudio = "mapSetAudio",
	MapSetAnimations = "mapSetAnimations",
	MapSetAssets = "mapSetAssets",
	MapSetObjects = "mapSetObjects",
	MapSetName = "mapSetName",
	MapSetDefaultChat = "mapSetDefaultChat",
	MapSetMuteOnEntry = "mapSetMuteOnEntry",
	MapSetUseDrawnBG = "mapSetUseDrawnBG",
	MapSetWalls = "mapSetWalls",
	MapSetFloors = "mapSetFloors",
	MapSetAreas = "mapSetAreas",
	MapDeleteObject = "mapDeleteObject",
	PlayerSetsIsAlone = "playerSetsIsAlone", // experimental
	PlayerJoins = "playerJoins",
	MapSetEnabledChats = "mapSetEnabledChats",
	MapSetDescription = "mapSetDescription",
	MapSetDecoration = "mapSetDecoration",
	MapSetTutorialTasks = "mapSetTutorialTasks",
	MapSetMiniMapImagePath = "mapSetMiniMapImagePath"
}
  
enum ClientServerAction
{
	ClientHeartbeat = "clientHeartbeat",
	ClientBackupHeartbeat = "clientBackupHeartbeat",
	UpdateSubscriptions = "updateSubscriptions",
	Move = "move",
	SetSprite = "setSprite",
	SetAffiliation = "setAffiliation",
	SetStatus = "setStatus",
	Spotlight = "spotlight",
	Ring = "ring",
	Ban = "ban",
	Kick = "kick",
	Chat = "chat",
	Interact = "interact",
	EnterWhisper = "enterWhisper",
	LeaveWhisper = "leaveWhisper",
	SetEmojiStatus = "setEmojiStatus",
	ActivelySpeaking = "activelySpeaking",
	SetEmote = "setEmote",
	SetName = "setName",
	SetTextStatus = "setTextStatus",
	Teleport = "teleport",
	Exit = "exit",
	Enter = "enter",
	SetWorkCondition = "setWorkCondition",
	Respawn = "respawn",
	Spawn = "spawn",
	Ghost = "ghost",
	Init = "init",
	SetOutfitString = "setOutfitString",
	ShootConfetti = "shootConfetti", // experimental
	SetEventStatus = "setEventStatus", // experimental
	SetInConversation = "setInConversation", // experimental
	SetCurrentDesk = "setCurrentDesk", // experimental
	SetCurrentArea = "setCurrentArea", // experimental
	SetImagePointer = "setImagePointer",
	SetGoKartId = "setGoKartId", // experimental
	MapSetDimensions = "mapSetDimensions",
	MapSetCollisions = "mapSetCollisions",
	MapSetBackgroundImagePath = "mapSetBackgroundImagePath",
	MapSetForegroundImagePath = "mapSetForegroundImagePath",
	MapSetSprites = "mapSetSprites",
	MapSetSpawns = "mapSetSpawns",
	MapSetSpaces = "mapSetSpaces",
	MapSetPortals = "mapSetPortals",
	MapSetAnnouncer = "mapSetAnnouncer",
	MapSetObjects = "mapSetObjects",
	MapSetName = "mapSetName",
	MapSetDefaultChat = "mapSetDefaultChat",
	MapSetMuteOnEntry = "mapSetMuteOnEntry",
	MapSetUseDrawnBG = "mapSetUseDrawnBG",
	MapSetWalls = "mapSetWalls",
	MapSetFloors = "mapSetFloors",
	MapSetAreas = "mapSetAreas", // experimental
	MapAddObject = "mapAddObject",
	MapDeleteObject = "mapDeleteObject",
	SetIsAlone = "setIsAlone", // experimental
	MapSetMiniMapImagePath = "mapSetMiniMapImagePath",
	MapSetEnabledChats = "mapSetEnabledChats",
	MapSetDescription = "mapSetDescription",
	MapSetDecoration = "mapSetDecoration",
	MapSetTutorialTasks = "mapSetTutorialTasks"
}
*/