export interface help_arg {
    key: string;
    description: string;
    permission: number;
    args: help_arg[];
}

export interface help {
    name: string;
    keyword: string;
    description: string;
    permission: number;
    args: help_arg[];
    platform: string;
}