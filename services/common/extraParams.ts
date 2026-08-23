// Parses a user-supplied JSON-object string (preset "extra params") into a
// plain object that can be spread into a request. Invalid/non-object input is
// ignored with a warning so a malformed field never breaks a generation call.
export const parseExtraParams = (extraParams?: string): Record<string, unknown> => {
    if (!extraParams || extraParams.trim() === '') return {};
    try {
        const parsed = JSON.parse(extraParams);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        console.warn('Extra params must be a JSON object. Ignoring invalid format.');
    } catch (e) {
        console.warn('Invalid JSON in extra parameters, ignoring.', e);
    }
    return {};
};
