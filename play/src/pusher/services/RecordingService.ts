import type { Recording, Thumbnail } from "@workadventure/messages";
import {
    LIVEKIT_RECORDING_S3_ENDPOINT,
    LIVEKIT_RECORDING_S3_CDN_ENDPOINT,
    LIVEKIT_RECORDING_S3_BUCKET,
    LIVEKIT_RECORDING_S3_ACCESS_KEY,
    LIVEKIT_RECORDING_S3_SECRET_KEY,
    LIVEKIT_RECORDING_S3_REGION,
} from "../enums/EnvironmentVariable";

// Lazy-loaded AWS SDK modules — only imported when ENABLE_S3_RECORDING is true
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let s3Module: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let presignerModule: any;

async function getS3Module() {
    if (process.env.ENABLE_S3_RECORDING !== "true") {
        throw new Error("S3 recording is disabled. Set ENABLE_S3_RECORDING=true and install @aws-sdk/client-s3.");
    }
    if (!s3Module) {
        s3Module = await import("@aws-sdk/client-s3");
    }
    return s3Module;
}

async function getPresignerModule() {
    if (process.env.ENABLE_S3_RECORDING !== "true") {
        throw new Error(
            "S3 recording is disabled. Set ENABLE_S3_RECORDING=true and install @aws-sdk/s3-request-presigner."
        );
    }
    if (!presignerModule) {
        presignerModule = await import("@aws-sdk/s3-request-presigner");
    }
    return presignerModule;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createS3Client(endpoint: string, accessKey: string, secretKey: string, region: string): Promise<any> {
    const { S3Client } = await getS3Module();
    return new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
        },
        forcePathStyle: true,
    });
}

export default class RecordingService {
    // Thumbnail signed URLs expire after 1 hour (for viewing in the recordings list)
    private static readonly THUMBNAIL_URL_EXPIRATION_SECONDS = 3600;

    public static async getRecords(userUuid: string): Promise<Recording[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let client: any;
        try {
            client = await this.getS3Client();
        } catch (error) {
            console.error("Error getting S3 client:", error);
            return [];
        }

        if (!LIVEKIT_RECORDING_S3_BUCKET) {
            console.error("LIVEKIT_RECORDING_S3_BUCKET is not configured");
            return [];
        }

        const contents = await this.listAllObjects(client, LIVEKIT_RECORDING_S3_BUCKET, `${userUuid}/`);

        if (contents.length === 0) {
            return [];
        }

        // Intermediate type for collecting data before generating signed URLs
        interface ThumbnailData {
            key: string;
            filename: string;
            size: number | undefined;
            sequenceNumber: number;
            timestampSeconds: number;
        }

        interface SessionData {
            timestamp: string;
            baseFilename: string;
            videoFile:
                | {
                      key: string;
                      filename: string;
                      size: number | undefined;
                  }
                | undefined;
            thumbnails: ThumbnailData[];
        }

        const sessions = new Map<string, SessionData>();

        contents.forEach((item: { Key?: string; Size?: number }) => {
            if (!item.Key) return;

            const filename = item.Key.replace(`${userUuid}/`, "");
            const timestampMatch = filename.match(/(recording|thumbnail)-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);

            if (!timestampMatch) return;

            const fileType = timestampMatch[1]; // "recording" or "thumbnail"
            const timestamp = timestampMatch[2];

            // Create the session if it doesn't exist
            if (!sessions.has(timestamp)) {
                sessions.set(timestamp, {
                    timestamp: timestamp,
                    baseFilename: `recording-${timestamp}`,
                    videoFile: undefined,
                    thumbnails: [],
                });
            }

            const session = sessions.get(timestamp)!;

            if (fileType === "recording") {
                session.videoFile = {
                    key: item.Key,
                    filename: filename,
                    size: item.Size !== undefined ? Number(item.Size) : undefined,
                };
            } else if (fileType === "thumbnail") {
                const sequenceMatch = filename.match(/_(\d+)\./);
                const sequenceNumber = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;
                const timestampSeconds = (sequenceNumber - 1) * 120;

                session.thumbnails.push({
                    key: item.Key,
                    filename: filename,
                    size: item.Size !== undefined ? Number(item.Size) : undefined,
                    sequenceNumber: sequenceNumber,
                    timestampSeconds: timestampSeconds,
                });
            }
        });

        // Filter and sort sessions
        const sortedSessions = Array.from(sessions.values())
            .filter((session) => session.videoFile !== undefined)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        // Generate signed URLs for all thumbnails
        const recordings: Recording[] = await Promise.all(
            sortedSessions.map(async (session) => {
                const sortedThumbnails = session.thumbnails.sort(
                    (a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0)
                );

                // Generate signed URLs for thumbnails
                const thumbnailsWithSignedUrls: Thumbnail[] = await Promise.all(
                    sortedThumbnails.map(async (thumb) => ({
                        key: thumb.key,
                        url: await this.generateThumbnailSignedUrl(thumb.key),
                        filename: thumb.filename,
                        size: thumb.size,
                        sequenceNumber: thumb.sequenceNumber,
                        timestampSeconds: thumb.timestampSeconds,
                    }))
                );

                return {
                    timestamp: session.timestamp,
                    baseFilename: session.baseFilename,
                    videoFile: session.videoFile,
                    thumbnails: thumbnailsWithSignedUrls,
                };
            })
        );

        return recordings;
    }

    /**
     * Generate a signed URL for a thumbnail image (for viewing purposes)
     */
    private static async generateThumbnailSignedUrl(key: string): Promise<string> {
        const client = await this.getS3ClientCDN();
        const { GetObjectCommand } = await getS3Module();

        const command = new GetObjectCommand({
            Bucket: LIVEKIT_RECORDING_S3_BUCKET,
            Key: key,
        });

        const { getSignedUrl } = await getPresignerModule();
        return getSignedUrl(client, command, { expiresIn: this.THUMBNAIL_URL_EXPIRATION_SECONDS });
    }

    public static async deleteRecord(userUuid: string, recordingId: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let client: any;
        try {
            client = await this.getS3Client();
        } catch (error) {
            console.error("Error getting S3 client:", error);
            return false;
        }

        if (!LIVEKIT_RECORDING_S3_BUCKET) {
            console.error("LIVEKIT_RECORDING_S3_BUCKET is not configured");
            return false;
        }

        try {
            const { DeleteObjectCommand } = await getS3Module();
            const contents = await this.listAllObjects(client, LIVEKIT_RECORDING_S3_BUCKET, `${userUuid}/`);

            if (contents.length === 0) {
                console.warn("No contents found in bucket");
                return false;
            }

            const timestampBase = recordingId.replace("recording-", "").replace(".mp4", "");
            const filesToDelete = contents
                .filter((item: { Key?: string }) => {
                    if (!item.Key) return false;

                    const recordingPath = `${userUuid}/${recordingId}`; // Full path of the recording
                    const thumbnailPrefix = `${userUuid}/thumbnail-${timestampBase}_`; // Prefix for the thumbnails

                    return item.Key === recordingPath || item.Key.startsWith(thumbnailPrefix);
                })
                .map((item: { Key: string }) => item.Key);

            if (filesToDelete.length === 0) {
                console.warn("No files found to delete for timestamp:", timestampBase);
                return false;
            }

            const deletePromises = filesToDelete.map(async (key: string) => {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: LIVEKIT_RECORDING_S3_BUCKET,
                    Key: key,
                });
                return client.send(deleteCommand);
            });

            await Promise.all(deletePromises);

            return true;
        } catch (error) {
            console.error("Error deleting recording:", error);
            return false;
        }
    }

    /**
     * List all objects in a S3 bucket with pagination support
     * @param client S3 client instance
     * @param bucket Bucket name
     * @param prefix Prefix to filter objects
     * @returns Array of all objects
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static async listAllObjects(client: any, bucket: string, prefix: string): Promise<any[]> {
        const { ListObjectsCommand } = await getS3Module();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allContents: any[] = [];
        let isTruncated = true;
        let marker: string | undefined = undefined;

        while (isTruncated) {
            const command = new ListObjectsCommand({
                Bucket: bucket,
                Prefix: prefix,
                Marker: marker,
            });

            // eslint-disable-next-line no-await-in-loop
            const response = await client.send(command);

            if (response.Contents) {
                allContents.push(...response.Contents);
            }

            isTruncated = response.IsTruncated ?? false;
            marker = response.NextMarker;

            // If IsTruncated is true but NextMarker is not provided,
            // use the last key as the marker for the next request
            if (isTruncated && !marker && response.Contents && response.Contents.length > 0) {
                marker = response.Contents[response.Contents.length - 1].Key;
            }
        }

        return allContents;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static async getS3Client(): Promise<any> {
        if (
            !LIVEKIT_RECORDING_S3_ENDPOINT ||
            !LIVEKIT_RECORDING_S3_BUCKET ||
            !LIVEKIT_RECORDING_S3_ACCESS_KEY ||
            !LIVEKIT_RECORDING_S3_SECRET_KEY ||
            !LIVEKIT_RECORDING_S3_REGION
        ) {
            console.warn("Recording S3 configuration is not set. Skipping fetching recordings.");
            throw new Error("Recording S3 configuration is not set. Skipping fetching recordings.");
        }

        return createS3Client(
            LIVEKIT_RECORDING_S3_ENDPOINT,
            LIVEKIT_RECORDING_S3_ACCESS_KEY,
            LIVEKIT_RECORDING_S3_SECRET_KEY,
            LIVEKIT_RECORDING_S3_REGION
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static async getS3ClientCDN(): Promise<any> {
        if (
            (!LIVEKIT_RECORDING_S3_CDN_ENDPOINT && !LIVEKIT_RECORDING_S3_ENDPOINT) ||
            !LIVEKIT_RECORDING_S3_BUCKET ||
            !LIVEKIT_RECORDING_S3_ACCESS_KEY ||
            !LIVEKIT_RECORDING_S3_SECRET_KEY ||
            !LIVEKIT_RECORDING_S3_REGION
        ) {
            console.warn("Recording S3 configuration is not set. Skipping fetching recordings.");
            throw new Error("Recording S3 configuration is not set. Skipping fetching recordings.");
        }

        return createS3Client(
            LIVEKIT_RECORDING_S3_CDN_ENDPOINT || LIVEKIT_RECORDING_S3_ENDPOINT!,
            LIVEKIT_RECORDING_S3_ACCESS_KEY,
            LIVEKIT_RECORDING_S3_SECRET_KEY,
            LIVEKIT_RECORDING_S3_REGION
        );
    }

    public static async getSignedUrl(key: string): Promise<string> {
        const client = await this.getS3ClientCDN();
        const { GetObjectCommand } = await getS3Module();
        const { getSignedUrl } = await getPresignerModule();

        // Extract filename from key for content disposition
        const filename = key.split("/").pop() || key;

        const command = new GetObjectCommand({
            Bucket: LIVEKIT_RECORDING_S3_BUCKET,
            Key: key,
            ResponseContentDisposition: `attachment; filename="${filename}"`,
            ResponseContentType: "application/octet-stream",
        });

        // 2 hours expiration for video playback in cowebsite
        const signedUrl = await getSignedUrl(client, command, { expiresIn: 7200 });

        return signedUrl;
    }
}
