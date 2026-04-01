import fs from "fs";
import { asError } from "catch-unknown";
import type { MatrixClient } from "matrix-js-sdk";
import { createClient, Method } from "matrix-js-sdk";
import { matrix_domain, matrix_server_url } from "../utils/urls";

const MATRIX_ADMIN_USER = `@admin:${matrix_domain}`;

const matrixLogin = {
    user: "admin",
    password: "MySecretPassword",
};

interface SynapseUser {
    name: string;
}

interface SynapseUsersResponse {
    users: SynapseUser[];
}

class MatrixApi {
    private client: MatrixClient | undefined;

    private async getClient() {
        if (!this.client) {
            this.client = createClient({
                baseUrl: matrix_server_url,
                userId: MATRIX_ADMIN_USER,
            });
            await this.client.login("m.login.password", matrixLogin);
        }
        return this.client;
    }

    public async resetMatrixUsers() {
        try {
            await this.getClient();
            const users = await this.getUsers();
            await this.deactivateAndActivateUsers(users);
        } catch (error) {
            console.error(error);
            throw error;
        }

        // When users are deactivated and activated again, the ACCESS_TOKEN changes. The Access token is stored in .auth folder in the browser's local storage.
        // To avoid issues, we clear the ./.auth/*.json files.
        const authFolderPath = "./.auth";
        try {
            const files = await fs.promises.readdir(authFolderPath);
            for (const file of files) {
                if (file.endsWith(".json")) {
                    await fs.promises.unlink(`${authFolderPath}/${file}`);
                }
            }
        } catch (error) {
            // If the .auth folder does not exist, we do nothing
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                console.error("Error while clearing .auth folder:", error);
                throw error;
            }
        }
    }

    private async getUsers(): Promise<SynapseUser[]> {
        try {
            const client = await this.getClient();
            const response = await client.http.authedRequest<SynapseUsersResponse>(
                Method.Get,
                "/_synapse/admin/v2/users",
            );
            return response.users.filter((user) => user.name !== MATRIX_ADMIN_USER);
        } catch (error) {
            throw asError(error);
        }
    }

    /**
     * It's not allowed to remove users in matrix using synapse server.
     * The correct way to do so, is to deactivate the user (it will remove all
     * properties related to e2ee) and activate it after.
     * @param users
     * @private
     */
    private async deactivateAndActivateUsers(users: { name: string }[]) {
        const client = await this.getClient();
        for (const user of users) {
            await client.http.authedRequest(Method.Post, `/_synapse/admin/v1/deactivate/${user.name}`);

            await client.http.authedRequest(Method.Put, `/_synapse/admin/v2/users/${user.name}`, undefined, {
                deactivated: false,
            });
        }
    }

    public async acceptAllInvitations(alias: string) {
        try {
            const client = await this.getClient();
            const publicRoomsResponse = await client.publicRooms({});
            const room = publicRoomsResponse.chunk.find((room) => room.name === alias);

            if (room) {
                await client.joinRoom(room.room_id);
            }
        } catch (error) {
            throw asError(error);
        }
    }

    public async acceptRoomInvitations(roomId: string) {
        if (roomId) {
            try {
                const client = await this.getClient();
                await client.joinRoom(roomId);
            } catch (error) {
                throw asError(error);
            }
        }
    }

    public async getMemberPowerLevel(roomId: string): Promise<number> {
        try {
            const client = await this.getClient();
            const powerLevels = await client.getStateEvent(roomId, "m.room.power_levels", "");

            return powerLevels.users[MATRIX_ADMIN_USER] || 0;
        } catch (error) {
            throw asError(error);
        }
    }

    public async overrideRateLimitForUser(userId: string) {
        try {
            const client = await this.getClient();
            await client.http.authedRequest(
                Method.Post,
                `/_synapse/admin/v1/users/${userId}/override_ratelimit`,
                undefined,
                {
                    message_per_second: 0,
                    burst_count: 0,
                },
            );
        } catch (error) {
            throw asError(error);
        }
    }
}

export default new MatrixApi();
