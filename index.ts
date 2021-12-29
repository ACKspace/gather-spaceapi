const SPACE_ID = "iVeuxmC1wz9bpz3p\\ACKspace";

import { API_KEY } from "./api-key";
import { Game, WireObject, ClientServerActionAction, MapSetObjects, MapDeleteObject, SetName } from "@gathertown/gather-game-client";

import { EventObject } from "./EventObject";

global.WebSocket = require("isomorphic-ws");

const modules: EventObject[] = [];
const addModule = ( module: any, param: string ) => {
	if ( !process.argv.includes( param ) )
		modules.push( new module() )
};

// Step 1: Import modules here
import { Spacestate } from "./SpaceAPI";

// Step 2: Add the module with its feature disable parameter
addModule( Spacestate, "--nospaceapi" );

// Flags
const DEBUG = process.argv.includes( "--debug" );				// debug setting (object printing and feature testing)
const VERBOSE = process.argv.includes( "--verbose" );			// verbose console output
const READONLY = process.argv.includes( "--readonly" );			// "readonly" gather connection
const CHANGE_NAME = !process.argv.includes( "--nonamechange" ); // don't touch our nickname

const game = new Game( () => Promise.resolve( { apiKey: API_KEY } ) );

const engineQueue: Array<ClientServerActionAction> = [];
let mapQueueTimer: NodeJS.Timer|undefined;

// Program initialization
( () => {
	console.log( new Date(), "init" );

	if ( DEBUG )
		console.log( "DEBUG mode");
	if ( VERBOSE )
		console.log( "VERBOSE mode");

	console.log("initializing.. press ctrl+c to stop this script");

	// Register events
	modules.forEach( module => {
		module.on( "objectRegister", objectRegister );
		module.on( "objectChanged", objectChanged );
		module.on( "objectRemove", objectRemove );
	} );

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
				sendMapAction( {
					$case: "setName",
					setName: {
						name: "NPC:spacestate",
					},
				} );
		}
	}

	modules.forEach( module => {
		module.init();
	} );
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
		// Mutex already defined, return it
		return mutexRooms[ _room ];
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
	const ids: { [id: string]: number } = { };
	Object.keys( roomObjects[ room ] ).find( ( key ) =>
	{
		const nkey = parseInt( key );
		const currentObject = roomObjects[ room ][ nkey ];
		if ( currentObject.id )
		{
			if ( currentObject.id in ids )
				console.warn( `/!\\ duplicate id's for "${currentObject.id}" in ${room}: ${ids[ currentObject.id ]} and ${nkey}` );
			ids[ currentObject.id ] = nkey;
		}
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

	const object = data.source.getObject( data.id, data.create );

	if ( VERBOSE )
		console.log( `set room object for key ${subscription.key}:`, object );

	// Update gather
	if ( !READONLY )
	{
		// Sanity check
		if ( object )
		{
			sendMapAction( {
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

function sendMapAction( action: ClientServerActionAction )
{
	if ( mapQueueTimer )
	{
		// Add to queue
		console.log( `queued action: ${action.$case}` );
		engineQueue.push( action )
	}
	else
	{
		if ( DEBUG )
			console.log( `direct action call: ${action.$case}` );

			// TODO: find a cleaner way to exit
			if ( action.$case === "exit" )
				process.exit( );
			else
				game.engine.sendAction( action );

		// Set a "timeout" for upcoming object changes so we can roll them up in one frame
		mapQueueTimer = setInterval( handleMapObjectQueue, 1000 / 15 );
	}
}

function handleMapObjectQueue()
{
	// Iterate array and combine objects of the same room
	if ( !engineQueue.length )
	{
		if ( DEBUG )
			console.log( "action queue empty" );
		//!\ NOTE: you might need to
		// change `function clearInterval(intervalId: NodeJS.Timeout): void;`
		// into:  `function clearInterval(intervalId: NodeJS.Timer): void;`
		// inside `node_modules/@types/node/timers.d.ts` since that was incorrect at xopr's repository
		if ( mapQueueTimer )
			clearInterval( mapQueueTimer );
		mapQueueTimer = undefined; // TODO: make this prettier
	}
	else
	{
		// Iterate queue
		for ( let n = 1; n < engineQueue.length; )
		{
			// Compare and splice magic
			if ( compareActionDeleteCurrent( engineQueue[ 0 ], engineQueue[ n ] ) )
				engineQueue.splice( n, 1 );
			else
				n++;
		}

		// Execute our combined object
		if ( DEBUG )
			console.log( `queued action call: ${engineQueue[ 0 ].$case}` );

		// TODO: find a cleaner way to exit
		if ( engineQueue[ 0 ].$case === "exit" )
			process.exit( );
		else
			game.engine.sendAction( engineQueue.splice( 0, 1 )[ 0 ] );
	}
}

function compareActionDeleteCurrent( action1: ClientServerActionAction, action2: ClientServerActionAction ): boolean
{
	// Different actions?
	if ( action1.$case !== action2.$case )
		return false;

	switch ( action1.$case )
	{
		case "mapSetObjects":
			const setObjects1 = action1.mapSetObjects;
			// The transcompiler has no way to assert we're working with the same types, so force it this way:
			const setObjects2 = (action2 as any).mapSetObjects as MapSetObjects;

			// Different room (map)?
			if ( setObjects1.mapId !== setObjects2.mapId )
				return false;

			// Copy over latter objects to former
			// TODO: check if assignment works
			Object.keys( setObjects2.objects ).forEach( key => {
				const nKey = parseInt( key );
				setObjects1.objects[ nKey ] = setObjects2.objects[ nKey ];
			} );

			// Objects migrated: remove the latter from the list
			return true;

		case "mapDeleteObject":
			const deleteObject1 = action1.mapDeleteObject;
			// The transcompiler has no way to assert we're working with the same types, so force it this way:
			const deleteObject2 = (action2 as any).mapDeleteObject as MapDeleteObject;

			// Different room (map)?
			if ( deleteObject1.mapId !== deleteObject2.mapId )
				return false;

			// Different key?
			if ( deleteObject1.key !== deleteObject2.key )
				return false;

			// Identical delete: remove the latter from the list
			return true;

		case "setName":
			const setName1 = action1.setName;
			// The transcompiler has no way to assert we're working with the same types, so force it this way:
			const setName2 = (action2 as any).setName as SetName;

			// Overwrite name and remove the latter from the list
			setName1.name = setName2.name;
			// TODO: check if assignment works
			// TODO: setName1.targetId?
			return true;
	}

	return false;
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
		sendMapAction( {
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

	modules.forEach( module => {
		module.destroy();
	} );

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
			sendMapAction( {
				$case: "setName",
				setName: {
					name: "xopr",
				},
			} );
		}
	}

	// TODO: find a cleaner way to exit
	sendMapAction( { $case: "exit", exit: false } );
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