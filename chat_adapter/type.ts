export type sender_role = 'owner' | 'admin' | 'member' | undefined
export type receive_type = 'private' | 'group'

export interface ChatAdapterMessage {
    adapter: string,
    instance_name: string,
    receiver: {
        id: number | string,
        type: receive_type,
        channel_name: string,
    },
    sender: {
        id: number | string,
        role: sender_role,
        name: string,
    },
    raw_message: string,
    message: any,
    timestamp: string,
    origin_object: any,
}