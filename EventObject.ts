import { EventEmitter } from "events";
import { WireObject } from "@gathertown/gather-game-client";

export class EventObject extends EventEmitter
{
    public init(): void {}
    public getObject( full: boolean): WireObject { return {} as WireObject }
    public setObject( object: WireObject, initialCall: boolean ): void {}
    public objectInteract( id: string ): boolean { return false }
    public destroy(): void {}
}