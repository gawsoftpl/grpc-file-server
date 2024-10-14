export const parseSize = (sizeStr: string): number => {
    const regex = /^(\d+(?:\.\d+)?)([kK]|[mM]|[gG]|[tT]|[pP]|[eE]|[zZ]|[yY]|b|kb|mb|gb|tb|pb|eb|zb|yb)?$/;
    const match = sizeStr.toLowerCase().match(regex);

    if (!match) {
        throw new Error('Invalid size format');
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    // Define multipliers for each unit
    const units = {
        'b': 1, // Bytes
        'kb': 1024, // Kilobytes
        'mb': 1024 ** 2, // Megabytes
        'gb': 1024 ** 3, // Gigabytes
        'tb': 1024 ** 4, // Terabytes
        'pb': 1024 ** 5, // Petabytes
        'eb': 1024 ** 6, // Exabytes
        'zb': 1024 ** 7, // Zettabytes
        'yb': 1024 ** 8  // Yottabytes
    };

    // Calculate total bytes
    const bytes = value * (units[unit] || 1);
    return bytes;
}