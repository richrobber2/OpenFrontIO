export interface DefensePostPosition {
  x: number;
  y: number;
  ownerID: number;
}

export function sameNumberSet(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

export function sameDefensePosts(
  posts: DefensePostPosition[],
  packed: number[],
): boolean {
  if (posts.length * 3 !== packed.length) return false;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const offset = i * 3;
    if (
      packed[offset] !== post.x ||
      packed[offset + 1] !== post.y ||
      packed[offset + 2] !== post.ownerID
    ) {
      return false;
    }
  }
  return true;
}
