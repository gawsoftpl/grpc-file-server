/* eslint-disable  @typescript-eslint/no-explicit-any */
export const yn = (value: any, default_: boolean): boolean => {
    if (default_ !== undefined && typeof default_ !== 'boolean') {
        throw new TypeError(
            `Expected the \`default\` option to be of type \`boolean\`, got \`${typeof default_}\``,
        );
    }
    if (value === undefined || value === null) {
        return default_;
    }

    value = String(value).trim();

    if (/^(?:y|yes|true|1|on)$/i.test(value)) {
        return true;
    }

    if (/^(?:n|no|false|0|off)$/i.test(value)) {
        return false;
    }

    return default_;
};
