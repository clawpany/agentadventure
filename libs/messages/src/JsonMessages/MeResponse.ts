import {z} from "zod";
import {extendApi} from "@anatine/zod-openapi";
import {
  ErrorApiData, // Keep this if ErrorApiData is still used elsewhere or for its type
  isErrorApiErrorData, // Assuming these are the schemas, not just type guards
  isErrorApiRetryData,
  isErrorApiRedirectData,
  isErrorApiUnauthorizedData,
} from "./ErrorApiData";
import {WokaDetail} from "./PlayerTextures";

export const MeSuccessResponse = extendApi(
    z.object({
        status: z.literal("ok"),
        authToken: extendApi(z.string(), {
            description:
                "The authToken.",
        }),
        userUuid: extendApi(z.string(), {
            description: "A unique identifier for the user.",
        }),
        email: extendApi(z.string().nullable().optional(), {
            description:
                "The email of the user.",
        }),
        username: extendApi(z.string().nullable().optional(), {
            description:
                "The name of the Woka.",
            example:
                "John",
        }),
        locale: extendApi(z.string().nullable().optional(), {
            description:
                "The locale (if returned by OpenID Connect).",
        }),
        /*textures: extendApi(z.array(z.object({
            id: extendApi(z.string(), {
                description:
                    "The id of the texture.",
            }),
        })), {
            description:
                "The textures of the Woka.",
        }),*/
        visitCardUrl: extendApi(z.string().nullable().optional(), {
            description:
                "The visit card URL of the Woka.",
        }),
        isCharacterTexturesValid: extendApi(z.boolean(), {
            description:
                "True if the character textures are valid, false if we need to redirect the user to the Woka selection page.",
            example: true,
        }),
        isCompanionTextureValid: extendApi(z.boolean(), {
            description:
                "True if the companion texture is valid, false if we need to redirect the user to the companion selection page.",
            example: true,
        }),
        matrixUserId: extendApi(z.string().nullable().optional(), {
            description:
                "The matrix user id of the user.", // Note: do we need this with OpenID Connect?
        }),
        matrixServerUrl: extendApi(z.string().nullable().optional(), {
            description:
                "The matrix server url for this user.",
        }),
        /*isMatrixRegistered: extendApi(z.boolean(), {
            description:
                "???",
        }),*/
    }),
    {
        description:
            'This is a response to the /me endpoint.',
    }
);

export type MeSuccessResponse = z.infer<typeof MeSuccessResponse>;

const MeResponseRaw = z.union([
    MeSuccessResponse,
    ErrorApiData
]);

export const MeResponse = z.any().superRefine((data, ctx) => {
    const isObject = z.record(z.string(), z.unknown()).safeParse(data);
    if (!isObject.success) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected an object",
        });
        return;
    }

    if (data.status === "ok") {
        const result = MeSuccessResponse.safeParse(data);
        if (!result.success) {
            result.error.issues.forEach((issue) => {
                ctx.addIssue({
                    ...issue,
                    path: [...ctx.path, ...issue.path],
                });
            });
        }
    } else if (data.status === "error") {
        const result = ErrorApiData.safeParse(data);
        if (!result.success) {
            result.error.issues.forEach((issue) => {
                ctx.addIssue({
                    ...issue,
                    path: [...ctx.path, ...issue.path],
                });
            });
        }
    } else {
        // Use raw union parse to get the default error if status is neither "ok" nor "error"
        const result = MeResponseRaw.safeParse(data);
        if (!result.success) {
            result.error.issues.forEach((issue) => {
                ctx.addIssue({
                    ...issue,
                    path: [...ctx.path, ...issue.path],
                });
            });
        }
    }
}) as unknown as typeof MeResponseRaw;
export type MeResponse = z.infer<typeof MeResponse>;