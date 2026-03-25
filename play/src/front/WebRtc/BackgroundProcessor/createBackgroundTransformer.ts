import { BACKGROUND_TRANSFORMER_ENGINE } from "../../Enum/EnvironmentVariable";
import { FallbackBackgroundTransformer } from "./FallbackBackgroundTransformer";

export type BackgroundMode = "none" | "blur" | "image" | "video";

export interface BackgroundConfig {
    mode: BackgroundMode;
    blurAmount?: number;
    backgroundImage?: string;
    backgroundVideo?: string;
}

export interface BackgroundTransformer {
    updateConfig(config: Partial<BackgroundConfig>): Promise<void>;
    getPerformanceStats(): unknown;
    close(): void;
    waitForInitialization(): Promise<void>;
    transform(inputStream: MediaStream, signal?: AbortSignal): Promise<MediaStream>;
    stop(): void;
}

/**
 * Create a MediaPipe-based background transformer with fallback support
 * Supports both the new Tasks Vision API (GPU-accelerated) and legacy Selfie Segmentation (CPU)
 * Selected via BACKGROUND_TRANSFORMER_ENGINE environment variable
 *
 * When __ENABLE_BACKGROUND_BLUR__ is false (build-time), MediaPipe deps are not bundled
 * and the fallback transformer is returned immediately.
 *
 * @param config Background configuration
 * @returns A MediaPipe transformer instance or fallback
 */
export function createBackgroundTransformer(config: BackgroundConfig): BackgroundTransformer {
    if (!__ENABLE_BACKGROUND_BLUR__) {
        console.info("[BackgroundProcessor] Background blur disabled at build time");
        return new FallbackBackgroundTransformer();
    }

    // Check browser support for MediaStream APIs
    if (typeof MediaStreamTrackProcessor === "undefined" || typeof MediaStreamTrackGenerator === "undefined") {
        return new FallbackBackgroundTransformer();
    }

    const engine = BACKGROUND_TRANSFORMER_ENGINE || "tasks-vision";
    console.info(`[BackgroundProcessor] Using transformer engine: ${engine}`);

    if (engine === "tasks-vision") {
        try {
            // Dynamic require so Vite can tree-shake when __ENABLE_BACKGROUND_BLUR__ is false
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { MediaPipeTasksVisionTransformer } = require("./MediaPipeTasksVisionTransformer");
            const transformer = new MediaPipeTasksVisionTransformer(config);
            return transformer;
        } catch (error) {
            console.error("[BackgroundTransformer] Failed to create Tasks Vision transformer, using fallback:", error);
            return new FallbackBackgroundTransformer();
        }
    }

    // Use selfie-segmentation API (legacy) when engine is not "tasks-vision"
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MediaPipeBackgroundTransformer } = require("./MediaPipeBackgroundTransformer");
        const transformer = new MediaPipeBackgroundTransformer(config);
        return transformer;
    } catch (error) {
        console.error(
            "[BackgroundTransformer] Failed to create Selfie Segmentation transformer, using fallback:",
            error
        );
        return new FallbackBackgroundTransformer();
    }
}
