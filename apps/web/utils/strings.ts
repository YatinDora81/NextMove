export function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
}

export function toTitleCase(str: string): string {
    if (!str) return str;
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}