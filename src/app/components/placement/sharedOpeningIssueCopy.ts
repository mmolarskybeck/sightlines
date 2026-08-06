import { getWallNames } from "../../projectWalls";
import type { Project, WallObject } from "../../../domain/project";
import { getOpeningKindLabel, type OpeningKind } from "../../../domain/placement/createOpening";
import type { SharedOpeningConflict } from "../../../domain/placement/sharedOpeningAnalysis";

// The words for what `sharedOpeningAnalysis` found. Everything the analyzer
// reports is expressed in document vocabulary — counterparts, twins, mirror
// slots, common spans — and none of that is language a curator laying out a
// show has ever met. This module is the only place that turns a
// `SharedOpeningConflict` into a sentence, so the panel that renders it never
// has to reach for a reason slug, an id, or a fallback string of its own.
//
// Three rules hold for every message below:
//
//   1. NAME THE PLACE. A curator needs to know which door in which room, so
//      every message resolves real room and wall names from the project and
//      degrades to a less specific but still TRUE sentence when a name cannot
//      be resolved — never to a printed id or the word "undefined".
//   2. SAY WHAT IT MEANS FOR THE PLAN, not what the data looks like. "so this
//      door no longer opens between them" beats "boundary lost".
//   3. STATE THE PROBLEM, DO NOT OFFER THE FIX. Resolution actions are a later
//      stage; copy that promises a button that does not exist is a broken
//      promise. Several of these are legitimate states in a plan the user is
//      mid-way through, so the tone stays neutral and factual.

export type SharedOpeningIssueDisplay = {
  id: string;
  openingId: string;
  // Short label shown above the message, like the placement panel's
  // "Door" / "Wall text" / an artwork title — the object plus, where it can be
  // resolved, the room it sits in.
  subject: string;
  // One sentence: what is wrong and what it means for the plan.
  message: string;
};

// Where a wall is, in words. Either half may be missing: a wall id that no
// longer resolves (a deleted room, a partition face) still has to produce a
// readable sentence.
type Place = { wallName: string | null; roomName: string | null };

const NO_PLACE: Place = { wallName: null, roomName: null };

function isOpeningKind(kind: WallObject["kind"]): kind is OpeningKind {
  return kind === "door" || kind === "window" || kind === "blocked-zone";
}

// Title case, for the subject line.
function openingLabel(object: WallObject | undefined): string {
  return object && isOpeningKind(object.kind) ? getOpeningKindLabel(object.kind) : "Opening";
}

// Mid-sentence, so lower case — same split openingEdits.ts already makes
// between headings and running text.
function openingNoun(object: WallObject | undefined): string {
  return openingLabel(object).toLowerCase();
}

function pluralNoun(noun: string): string {
  return `${noun}s`;
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Reuses the wall inspector's naming helper so an issue names a wall exactly
// as the rest of the app does. `getWallNames` falls back to the raw id for a
// wall it cannot resolve, which is precisely what must never reach a message —
// so an unresolved name is detected here and dropped.
function placeOf(project: Project, wallId: string | undefined): Place {
  if (wallId === undefined) return NO_PLACE;

  const [resolvedWallName] = getWallNames(project, [wallId]);
  const wallName =
    resolvedWallName !== undefined && resolvedWallName !== wallId && resolvedWallName.trim() !== ""
      ? resolvedWallName
      : null;

  const room = project.floor.rooms.find((placement) =>
    placement.room.walls.some((wall) => wall.id === wallId)
  )?.room;
  const roomName = room && room.name.trim() !== "" ? room.name : null;

  return { wallName, roomName };
}

// "East wall in Gallery 1", "East wall", or nothing at all.
function wallInRoom(place: Place): string | null {
  if (place.wallName === null) return null;
  return place.roomName === null ? place.wallName : `${place.wallName} in ${place.roomName}`;
}

function distinctRoomNames(places: Place[]): string[] {
  const names: string[] = [];
  for (const place of places) {
    if (place.roomName !== null && !names.includes(place.roomName)) names.push(place.roomName);
  }
  return names;
}

function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeSharedOpeningConflict(
  conflict: SharedOpeningConflict,
  project: Project
): SharedOpeningIssueDisplay {
  const objectsById = new Map(project.wallObjects.map((object) => [object.id, object]));
  const opening = objectsById.get(conflict.openingId);
  const noun = openingNoun(opening);

  // wallIds is [own wall, ...counterpart walls]; fall back to the opening's own
  // wall if a conflict ever arrives with an empty list.
  const own = placeOf(project, conflict.wallIds[0] ?? opening?.wallId);
  const other = placeOf(project, conflict.wallIds[1]);
  const counterpartPlaces = conflict.wallIds.slice(1).map((wallId) => placeOf(project, wallId));

  const subject =
    own.roomName !== null
      ? `${openingLabel(opening)} in ${own.roomName}`
      : own.wallName !== null
        ? `${openingLabel(opening)} on ${own.wallName}`
        : openingLabel(opening);

  const ownWall = own.wallName ?? "this wall";
  const blocker = conflict.blockerId === undefined ? undefined : objectsById.get(conflict.blockerId);

  const message = ((): string => {
    switch (conflict.reason) {
      case "ambiguous-boundary-wall": {
        // The opening fits inside the run its wall shares with two or more
        // other walls: genuinely two rooms behind the same stretch of wall.
        const rooms = distinctRoomNames(counterpartPlaces);
        const behind =
          rooms.length >= 2
            ? `${formatList(rooms)} ${rooms.length === 2 ? "both sit" : "all sit"}`
            : "More than one room sits";
        return `${behind} behind ${ownWall} here, so it isn't clear which one this ${noun} opens into.`;
      }

      case "ambiguous-counterpart-opening": {
        // A cluster of three or more openings that all read as one another's
        // other face — no single pairing is the obvious one.
        const rooms = distinctRoomNames([own, ...counterpartPlaces]);
        const between = rooms.length >= 2 ? `the wall between ${formatList(rooms)}` : "this shared wall";
        return `Several ${pluralNoun(noun)} line up on both sides of ${between}, so it isn't clear which of them are two sides of the same ${noun}.`;
      }

      case "overhangs-common-span": {
        // Touches a shared run without fitting inside it — the walls really are
        // shared, the opening just straddles the end of the shared part.
        const rooms = distinctRoomNames(counterpartPlaces);
        const neighbours = rooms.length > 0 ? formatList(rooms) : "the room behind it";
        const target = rooms.length > 1 ? "those rooms" : "that room";
        return `This ${noun} runs past the end of the stretch ${ownWall} shares with ${neighbours}, so only part of it opens into ${target}.`;
      }

      case "paired-overhang": {
        // Both halves exist and still face each other, but the run the two
        // rooms have in common no longer covers the opening.
        const rooms = distinctRoomNames([own, other]);
        const pair = rooms.length === 2 ? formatList(rooms) : "the two rooms";
        return `This ${noun} reaches past the stretch of wall that ${pair} share, so part of it doesn't open between them.`;
      }

      case "paired-geometry-mismatch": {
        // Width, height or hang height differ between the two halves of what is
        // meant to be one physical opening.
        const rooms = distinctRoomNames([own, other]);
        const sides = rooms.length === 2 ? `in ${rooms[0]} than in ${rooms[1]}` : "on each side of the wall";
        return `This ${noun} is a different size or sits at a different height ${sides}, so its two sides don't match as one opening.`;
      }

      case "counterpart-occupied": {
        // A door or window already stands where this one's other face would go.
        const blockerNoun = blocker ? openingNoun(blocker) : null;
        const standing =
          blockerNoun === null
            ? "another door or window"
            : blockerNoun === noun
              ? `another ${noun}`
              : withArticle(blockerNoun);
        const holder = other.roomName ?? "The facing wall";
        return `${holder} already has ${standing} in the spot directly opposite, so this ${noun} isn't shared between the two rooms.`;
      }

      case "blocked-mirror-slot": {
        // The matching position on the facing wall is taken by something that
        // could never be this opening's other face — or cannot be worked out.
        const spot =
          wallInRoom(other) ??
          (other.roomName === null ? "the facing wall" : `the facing wall in ${other.roomName}`);
        return blocker
          ? `${capitalize(withArticle(openingNoun(blocker)))} stands in the matching spot for this ${noun} on ${spot}, so its two sides can't line up.`
          : `The matching spot for this ${noun} on ${spot} isn't free, so its two sides can't line up.`;
      }

      case "missing-twin": {
        // Drawn on one face of a shared wall only.
        const ownSide = own.roomName === null ? "one side" : `the ${own.roomName} side`;
        const otherSide = other.roomName === null ? "the facing side" : `the ${other.roomName} side`;
        return `This ${noun} appears on ${ownSide} of the wall but not on ${otherSide}.`;
      }

      case "boundary-lost": {
        // The two halves are still linked, but their walls no longer face each
        // other — the rooms have moved apart or one of them has changed shape.
        const rooms = distinctRoomNames([own, other]);
        return rooms.length === 2
          ? `${formatList(rooms)} no longer share a wall here, so this ${noun} no longer opens between them.`
          : `The two rooms this ${noun} joined no longer share a wall here, so it no longer opens between them.`;
      }

      default: {
        // A new reason in the union lands here as a compile error rather than
        // silently reaching the panel as a generic string.
        const exhaustive: never = conflict.reason;
        return exhaustive;
      }
    }
  })();

  return { id: conflict.id, openingId: conflict.openingId, subject, message };
}
