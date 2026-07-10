import {EventEmitter} from "node:events";

export class event_emitter extends EventEmitter {
    emit(event: string | symbol, ...args: any) {
        super.emit('*', event, ...args); // 先通知 onAny
        return super.emit(event, ...args);
    }

    onAny(listener: (...args: any[]) => void) {
        this.on('*', listener);
    }

    offAny(listener: (...args: any[]) => void) {
        this.off('*', listener);
    }
}
