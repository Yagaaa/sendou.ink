import shuffle from "just-shuffle";
import { type InferResult, sql } from "kysely";
import { db } from "~/db/sql";
import type { Tables, TablesInsertable } from "~/db/tables";
import {
  nextNonCompletedVoting,
  type MonthYear,
  rangeToMonthYear,
} from "~/features/plus-voting/core";
import { COMMON_USER_FIELDS } from "~/utils/kysely.server";
import type { Unwrapped } from "~/utils/types";
import * as PlusSuggestionRepository from "~/features/plus-suggestions/PlusSuggestionRepository.server";
import invariant from "tiny-invariant";

const resultsByMonthYearQuery = (args: MonthYear) =>
  db
    .selectFrom("PlusVotingResult")
    .innerJoin("User", "PlusVotingResult.votedId", "User.id")
    .select([
      ...COMMON_USER_FIELDS,
      "PlusVotingResult.wasSuggested",
      "PlusVotingResult.passedVoting",
      "PlusVotingResult.tier",
      "PlusVotingResult.score",
    ])
    .where("PlusVotingResult.month", "=", args.month)
    .where("PlusVotingResult.year", "=", args.year)
    .orderBy(sql`"User"."discordName" collate nocase`, "asc");
type ResultsByMonthYearQueryReturnType = InferResult<
  ReturnType<typeof resultsByMonthYearQuery>
>;

export type ResultsByMonthYearItem = Unwrapped<typeof resultsByMonthYear>;
export async function resultsByMonthYear(args: MonthYear) {
  const rows = await resultsByMonthYearQuery(args).execute();

  return groupPlusVotingResults(rows);
}

function groupPlusVotingResults(rows: ResultsByMonthYearQueryReturnType) {
  const grouped: Record<
    number,
    {
      passed: ResultsByMonthYearQueryReturnType;
      failed: ResultsByMonthYearQueryReturnType;
    }
  > = {};

  for (const row of rows) {
    const playersOfTier = grouped[row.tier] ?? {
      passed: [],
      failed: [],
    };
    grouped[row.tier] = playersOfTier;

    playersOfTier[row.passedVoting ? "passed" : "failed"].push(row);
  }

  return Object.entries(grouped)
    .map(([tier, { passed, failed }]) => ({
      tier: Number(tier),
      passed,
      failed,
    }))
    .sort((a, b) => a.tier - b.tier);
}

export type UsersForVoting = {
  user: Pick<
    Tables["User"],
    "id" | "discordId" | "discordName" | "discordAvatar" | "bio"
  >;
  suggestion?: PlusSuggestionRepository.FindAllByMonthItem;
}[];

export async function usersForVoting(loggedInUser: {
  id: number;
  plusTier: number;
}) {
  const members = await db
    .selectFrom("User")
    .innerJoin("PlusTier", "PlusTier.userId", "User.id")
    .select([...COMMON_USER_FIELDS, "User.bio"])
    .where("PlusTier.tier", "=", loggedInUser.plusTier)
    .execute();

  const suggestedUsers = (
    await PlusSuggestionRepository.findAllByMonth(
      rangeToMonthYear(nextNonCompletedVoting(new Date())),
    )
  ).filter((suggestion) => suggestion.tier === loggedInUser.plusTier);
  invariant(suggestedUsers);

  const result: UsersForVoting = [];

  for (const member of members) {
    result.push({
      user: {
        id: member.id,
        discordId: member.discordId,
        discordName: member.discordName,
        discordAvatar: member.discordAvatar,
        bio: member.bio,
      },
    });
  }

  for (const suggestion of suggestedUsers) {
    result.push({
      user: {
        id: suggestion.suggested.id,
        discordId: suggestion.suggested.discordId,
        discordName: suggestion.suggested.discordName,
        discordAvatar: suggestion.suggested.discordAvatar,
        bio: suggestion.suggested.bio,
      },
      suggestion,
    });
  }

  return shuffle(result.filter(({ user }) => user.id !== loggedInUser.id));
}

export async function hasVoted(args: {
  authorId: number;
  month: number;
  year: number;
}) {
  const rows = await db
    .selectFrom("PlusVote")
    .select(({ eb }) => eb.lit(1).as("one"))
    .where("PlusVote.authorId", "=", args.authorId)
    .where("PlusVote.month", "=", args.month)
    .where("PlusVote.year", "=", args.year)
    .execute();

  return rows.length > 0;
}

export type UpsertManyPlusVotesArgs = Pick<
  TablesInsertable["PlusVote"],
  "month" | "year" | "tier" | "authorId" | "votedId" | "score" | "validAfter"
>[];
export function upsertMany(votes: UpsertManyPlusVotesArgs) {
  const firstVote = votes[0];

  return db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("PlusVote")
      .where("PlusVote.authorId", "=", firstVote.authorId)
      .where("PlusVote.month", "=", firstVote.month)
      .where("PlusVote.year", "=", firstVote.year)
      .execute();

    await trx.insertInto("PlusVote").values(votes).execute();
  });
}
