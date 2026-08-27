"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLastJsonObject = extractLastJsonObject;
exports.readObject = readObject;
exports.readString = readString;
exports.readOptionalString = readOptionalString;
exports.readArray = readArray;
exports.readBoolean = readBoolean;
exports.readNumber = readNumber;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Finds balanced JSON objects while respecting quoted strings and escapes.
 * The last successfully parsed object is returned because CLI agents often emit
 * progress prose before the final structured answer.
 */
function extractLastJsonObject(text) {
    const candidates = [];
    const starts = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (character === "\\") {
                escaped = true;
            }
            else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === "{") {
            starts.push(index);
            continue;
        }
        if (character === "}" && starts.length > 0) {
            const start = starts.pop();
            candidates.push({ start, end: index, value: text.slice(start, index + 1) });
        }
    }
    candidates.sort((left, right) => right.end - left.end || left.start - right.start);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate.value);
            if (isRecord(parsed))
                return parsed;
        }
        catch {
            // Try the preceding balanced candidate.
        }
    }
    throw new Error("No valid JSON object was found in the agent response.");
}
function readObject(value, fieldName) {
    if (!isRecord(value))
        throw new Error(`${fieldName} must be an object.`);
    return value;
}
function readString(value, fieldName) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${fieldName} must be a non-empty string.`);
    }
    return value.trim();
}
function readOptionalString(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}
function readArray(value, fieldName) {
    if (!Array.isArray(value))
        throw new Error(`${fieldName} must be an array.`);
    return value;
}
function readBoolean(value, defaultValue = false) {
    return typeof value === "boolean" ? value : defaultValue;
}
function readNumber(value, fieldName, options = {}) {
    const number = typeof value === "number" && Number.isFinite(value) ? value : options.defaultValue;
    if (number === undefined)
        throw new Error(`${fieldName} must be a finite number.`);
    if (options.min !== undefined && number < options.min) {
        throw new Error(`${fieldName} must be >= ${options.min}.`);
    }
    if (options.max !== undefined && number > options.max) {
        throw new Error(`${fieldName} must be <= ${options.max}.`);
    }
    return number;
}
