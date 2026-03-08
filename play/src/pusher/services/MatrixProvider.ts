import pLimit from "p-limit";
import type { ICreateRoomOpts, MatrixClient } from "matrix-js-sdk";
import { createClient, EventType, Visibility, Method } from "matrix-js-sdk";
import { MATRIX_ADMIN_PASSWORD, MATRIX_ADMIN_USER, MATRIX_API_URI, MATRIX_DOMAIN } from "../enums/EnvironmentVariable";

const ADMIN_CHAT_ID = `@${MATRIX_ADMIN_USER}:${MATRIX_DOMAIN}`;

const limit = pLimit(10);
class MatrixProvider {
    private client: MatrixClient | undefined;
    private roomAreaFolderName = "current-visited-room";
    private roomAreaFolderID: string | undefined;

    constructor() {
        this.initialize().catch((error) => {
            console.error("Failed to initialize MatrixProvider:", error);
        });
    }

    private async initialize() {
        await this.overrideRateLimitForAdminAccount();
        const roomID = await this.createChatFolderAreaAndSetID();
        this.roomAreaFolderID = roomID;
    }

    private async getClient(): Promise<MatrixClient> {
        if (!this.client) {
            if (!MATRIX_API_URI || !MATRIX_ADMIN_USER || !MATRIX_ADMIN_PASSWORD) {
                throw new Error("Matrix environment variables are not fully configured");
            }
            this.client = createClient({
                baseUrl: MATRIX_API_URI,
                userId: `@${MATRIX_ADMIN_USER}:${MATRIX_DOMAIN}`,
            });
            await this.client.login("m.login.password", {
                user: MATRIX_ADMIN_USER,
                password: MATRIX_ADMIN_PASSWORD,
            });
        }
        return this.client;
    }

    getMatrixIdFromEmail(email: string): string {
        return "@" + this.getBareMatrixIdFromEmail(email) + ":" + MATRIX_DOMAIN;
    }

    getBareMatrixIdFromEmail(email: string): string {
        return email.replace("@", "_");
    }

    async setNewMatrixPassword(matrixUserId: string, password: string): Promise<void> {
        const client = await this.getClient();
        await client.http.authedRequest(Method.Put, `/_synapse/admin/v2/users/${matrixUserId}`, undefined, {
            logout_devices: false,
            password,
        });
    }

    async createRoomForArea(): Promise<string> {
        const options: ICreateRoomOpts = {
            visibility: Visibility.Private,
            initial_state: [
                {
                    type: EventType.RoomHistoryVisibility,
                    content: { history_visibility: "joined" },
                },
            ],
            power_level_content_override: {
                invite: 100,
                ban: 50,
                kick: 50,
            },
        };

        if (this.roomAreaFolderID && MATRIX_DOMAIN) {
            options.initial_state?.push({
                type: EventType.SpaceParent,
                state_key: this.roomAreaFolderID,
                content: {
                    via: [MATRIX_DOMAIN],
                },
            });
        }

        const client = await this.getClient();
        const response = await client.createRoom(options);
        return await this.AddRoomToFolder(response.room_id);
    }

    async kickUserFromRoom(userID: string, roomID: string): Promise<void> {
        const client = await this.getClient();
        await client.kick(roomID, userID, "kick");
    }

    async promoteUserToModerator(userID: string, roomID: string): Promise<void> {
        const client = await this.getClient();
        await client.setPowerLevel(roomID, userID, 50);
    }
    async inviteUserToRoom(userID: string, roomID: string): Promise<void> {
        if (!roomID) {
            console.error("roomID is undefined or null");
            return;
        }
        const client = await this.getClient();
        await client.invite(roomID, userID);
    }

    async changeRoomName(roomID: string, name: string): Promise<void> {
        const client = await this.getClient();
        await client.setRoomName(roomID, name);
    }

    private async overrideRateLimitForAdminAccount() {
        const client = await this.getClient();
        await client.http.authedRequest(
            Method.Post,
            `/_synapse/admin/v1/users/${ADMIN_CHAT_ID}/override_ratelimit`,
            undefined,
            {
                message_per_second: 0,
                burst_count: 0,
            }
        );
    }

    private async createChatFolderAreaAndSetID(): Promise<string> {
        try {
            const folderAreaID = await this.getChatFolderAreaID();
            if (folderAreaID) {
                return folderAreaID;
            }
        } catch (error) {
            console.info(`Failed to get chat folder area ID, creating one ${error}`);
        }

        const client = await this.getClient();
        const response = await client.createRoom({
            visibility: Visibility.Public,
            room_alias_name: this.roomAreaFolderName,
            name: this.roomAreaFolderName,
            creation_content: {
                type: "m.space",
            },
        });
        return response.room_id;
    }

    private async getChatFolderAreaID(): Promise<string | undefined> {
        const client = await this.getClient();
        try {
            const response = await client.getRoomIdForAlias(`#${this.roomAreaFolderName}:${MATRIX_DOMAIN}`);
            return response.room_id;
        } catch {
            return undefined;
        }
    }

    async AddRoomToFolder(roomID: string): Promise<string> {
        if (!this.roomAreaFolderID) {
            console.error(new Error(`Failed to add room : ${roomID} to room area folder `));
            return roomID;
        }

        const client = await this.getClient();
        await client.sendStateEvent(this.roomAreaFolderID, EventType.SpaceChild, { via: [MATRIX_DOMAIN] }, roomID);
        return roomID;
    }

    async deleteRoom(roomID: string): Promise<void> {
        await this.kickAllUsersFromRoom(roomID);
        return this.kickUserFromRoom(ADMIN_CHAT_ID, roomID);
    }

    async kickAllUsersFromRoom(roomID: string): Promise<void> {
        const client = await this.getClient();
        const members = await client.getJoinedRoomMembers(roomID);

        const kickMembersPromises = Object.keys(members.joined).reduce((acc: Promise<void>[], userID: string) => {
            if (userID !== ADMIN_CHAT_ID) {
                acc.push(limit(() => this.kickUserFromRoom(userID, roomID)));
            }
            return acc;
        }, []);

        try {
            await Promise.all(kickMembersPromises);
        } catch (e) {
            console.error("Failed to kick all user", e);
        }
    }
}

export const matrixProvider = new MatrixProvider();
