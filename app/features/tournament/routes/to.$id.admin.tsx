import type { ActionFunction } from "@remix-run/node";
import { useFetcher, useOutletContext, useSubmit } from "@remix-run/react";
import * as React from "react";
import { Button, LinkButton } from "~/components/Button";
import { Toggle } from "~/components/Toggle";
import { useTranslation } from "react-i18next";
import { canAdminTournament, isAdmin } from "~/permissions";
import { notFoundIfFalsy, parseRequestFormData, validate } from "~/utils/remix";
import { discordFullName } from "~/utils/strings";
import { findTeamsByTournamentId } from "../queries/findTeamsByTournamentId.server";
import { updateShowMapListGenerator } from "../queries/updateShowMapListGenerator.server";
import { requireUserId } from "~/features/auth/core/user.server";
import {
  HACKY_resolveCheckInTime,
  tournamentIdFromParams,
  validateCanCheckIn,
} from "../tournament-utils";
import { SubmitButton } from "~/components/SubmitButton";
import { adminActionSchema } from "../tournament-schemas.server";
import { changeTeamOwner } from "../queries/changeTeamOwner.server";
import invariant from "tiny-invariant";
import { assertUnreachable } from "~/utils/types";
import { checkIn } from "../queries/checkIn.server";
import { checkOut } from "../queries/checkOut.server";
import hasTournamentStarted from "../queries/hasTournamentStarted.server";
import type { TournamentLoaderData } from "./to.$id";
import { joinTeam, leaveTeam } from "../queries/joinLeaveTeam.server";
import { deleteTeam } from "../queries/deleteTeam.server";
import { useUser } from "~/features/auth/core";
import {
  calendarEditPage,
  calendarEventPage,
  tournamentPage,
} from "~/utils/urls";
import { Redirect } from "~/components/Redirect";
import { FormWithConfirm } from "~/components/FormWithConfirm";
import { findMapPoolByTeamId } from "~/features/tournament-bracket";
import { UserSearch } from "~/components/UserSearch";
import * as TournamentRepository from "../TournamentRepository.server";
import { createTeam } from "../queries/createTeam.server";

export const action: ActionFunction = async ({ request, params }) => {
  const user = await requireUserId(request);
  const data = await parseRequestFormData({
    request,
    schema: adminActionSchema,
  });

  const tournamentId = tournamentIdFromParams(params);
  const tournament = notFoundIfFalsy(
    await TournamentRepository.findById(tournamentId),
  );
  const teams = findTeamsByTournamentId(tournament.id);

  validate(canAdminTournament({ user, tournament }), "Unauthorized", 401);

  switch (data._action) {
    case "ADD_TEAM": {
      validate(
        teams.every((t) => t.name !== data.teamName),
        "Team name taken",
      );
      validate(
        teams.every((t) => t.members.every((m) => m.userId !== data.userId)),
        "User already on a team",
      );

      createTeam({
        name: data.teamName,
        tournamentId: tournamentId,
        ownerId: data.userId,
        prefersNotToHost: 0,
      });

      break;
    }
    case "UPDATE_SHOW_MAP_LIST_GENERATOR": {
      updateShowMapListGenerator({
        tournamentId: tournament.id,
        showMapListGenerator: Number(data.show),
      });
      break;
    }
    case "CHANGE_TEAM_OWNER": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");
      const oldCaptain = team.members.find((m) => m.isOwner);
      invariant(oldCaptain, "Team has no captain");
      const newCaptain = team.members.find((m) => m.userId === data.memberId);
      validate(newCaptain, "Invalid member id");

      changeTeamOwner({
        newCaptainId: data.memberId,
        oldCaptainId: oldCaptain.userId,
        tournamentTeamId: data.teamId,
      });

      break;
    }
    case "CHECK_IN": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");
      validateCanCheckIn({
        event: tournament,
        team,
        mapPool: findMapPoolByTeamId(team.id),
      });

      checkIn(team.id);
      break;
    }
    case "CHECK_OUT": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");
      validate(!hasTournamentStarted(tournament.id), "Tournament has started");

      checkOut(team.id);
      break;
    }
    case "REMOVE_MEMBER": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");
      validate(!team.checkedInAt, "Team is checked in");
      validate(
        !team.members.find((m) => m.userId === data.memberId)?.isOwner,

        "Cannot remove team owner",
      );

      leaveTeam({
        userId: data.memberId,
        teamId: team.id,
      });
      break;
    }
    // TODO: could also handle the case of admin trying
    // to add members from a checked in team
    case "ADD_MEMBER": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");

      const previousTeam = teams.find((t) =>
        t.members.some((m) => m.userId === data.userId),
      );

      if (hasTournamentStarted(tournament.id)) {
        validate(
          !previousTeam || !previousTeam.checkedInAt,
          "User is already on a checked in team",
        );
      } else {
        validate(!previousTeam, "User is already on a team");
      }

      joinTeam({
        userId: data.userId,
        newTeamId: team.id,
        previousTeamId: previousTeam?.id,
        // this team is not checked in so we can simply delete it
        whatToDoWithPreviousTeam: previousTeam ? "DELETE" : undefined,
        tournamentId,
      });
      break;
    }
    case "DELETE_TEAM": {
      const team = teams.find((t) => t.id === data.teamId);
      validate(team, "Invalid team id");
      validate(!hasTournamentStarted(tournament.id), "Tournament has started");

      deleteTeam(team.id);
      break;
    }
    default: {
      assertUnreachable(data);
    }
  }

  return null;
};

// TODO: translations
export default function TournamentAdminPage() {
  const { t } = useTranslation(["calendar"]);
  const data = useOutletContext<TournamentLoaderData>();

  const user = useUser();

  if (
    !canAdminTournament({ user, tournament: data.tournament }) ||
    data.hasFinalized
  ) {
    return <Redirect to={tournamentPage(data.tournament.id)} />;
  }

  return (
    <div className="stack md">
      <AdminActions />
      {isAdmin(user) ? <EnableMapList /> : null}
      <DownloadParticipants />
      <div className="stack horizontal items-end mt-4">
        <LinkButton
          to={calendarEditPage(data.tournament.eventId)}
          size="tiny"
          variant="outlined"
        >
          Edit event info
        </LinkButton>
        {!data.hasStarted ? (
          <FormWithConfirm
            dialogHeading={t("calendar:actions.delete.confirm", {
              name: data.tournament.name,
            })}
            action={calendarEventPage(data.tournament.eventId)}
            submitButtonTestId="delete-submit-button"
          >
            <Button
              className="ml-auto"
              size="tiny"
              variant="minimal-destructive"
              type="submit"
            >
              {t("calendar:actions.delete")}
            </Button>
          </FormWithConfirm>
        ) : null}
      </div>
    </div>
  );
}

type Input = "TEAM_NAME" | "REGISTERED_TEAM" | "USER" | "ROSTER_MEMBER";
const actions = [
  {
    type: "ADD_TEAM",
    inputs: ["USER", "TEAM_NAME"] as Input[],
    when: ["TOURNAMENT_BEFORE_START"],
  },
  {
    type: "CHANGE_TEAM_OWNER",
    inputs: ["ROSTER_MEMBER", "REGISTERED_TEAM"] as Input[],
    when: [],
  },
  {
    type: "CHECK_IN",
    inputs: ["REGISTERED_TEAM"] as Input[],
    when: ["CHECK_IN_STARTED", "TOURNAMENT_BEFORE_START"],
  },
  {
    type: "CHECK_OUT",
    inputs: ["REGISTERED_TEAM"] as Input[],
    when: ["CHECK_IN_STARTED", "TOURNAMENT_BEFORE_START"],
  },
  {
    type: "ADD_MEMBER",
    inputs: ["USER", "REGISTERED_TEAM"] as Input[],
    when: [],
  },
  {
    type: "REMOVE_MEMBER",
    inputs: ["ROSTER_MEMBER", "REGISTERED_TEAM"] as Input[],
    when: ["TOURNAMENT_BEFORE_START"],
  },
  {
    type: "DELETE_TEAM",
    inputs: ["REGISTERED_TEAM"] as Input[],
    when: ["TOURNAMENT_BEFORE_START"],
  },
] as const;

function AdminActions() {
  const fetcher = useFetcher();
  const { t } = useTranslation(["tournament"]);
  const data = useOutletContext<TournamentLoaderData>();
  const parentRouteData = useOutletContext<TournamentLoaderData>();
  const [selectedTeamId, setSelectedTeamId] = React.useState(data.teams[0]?.id);
  const [selectedAction, setSelectedAction] = React.useState<
    (typeof actions)[number]
  >(actions[0]);

  const selectedTeam = data.teams.find((team) => team.id === selectedTeamId);

  const actionsToShow = actions.filter((action) => {
    for (const when of action.when) {
      switch (when) {
        case "CHECK_IN_STARTED": {
          if (
            HACKY_resolveCheckInTime(data.tournament).getTime() > Date.now()
          ) {
            return false;
          }

          break;
        }
        case "TOURNAMENT_BEFORE_START": {
          if (parentRouteData.hasStarted) {
            return false;
          }
          break;
        }
        default: {
          assertUnreachable(when);
        }
      }
    }

    return true;
  });

  return (
    <fetcher.Form
      method="post"
      className="stack horizontal sm items-end flex-wrap"
    >
      <div>
        <label htmlFor="action">Action</label>
        <select
          id="action"
          name="action"
          value={selectedAction.type}
          onChange={(e) =>
            setSelectedAction(actions.find((a) => a.type === e.target.value)!)
          }
        >
          {actionsToShow.map((action) => (
            <option key={action.type} value={action.type}>
              {t(`tournament:admin.actions.${action.type}`)}
            </option>
          ))}
        </select>
      </div>
      {selectedAction.inputs.includes("REGISTERED_TEAM") ? (
        <div>
          <label htmlFor="teamId">Team</label>
          <select
            id="teamId"
            name="teamId"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(Number(e.target.value))}
          >
            {data.teams
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      {selectedAction.inputs.includes("TEAM_NAME") ? (
        <div>
          <label htmlFor="teamId">Team name</label>
          <input id="teamName" name="teamName" />
        </div>
      ) : null}
      {selectedTeam && selectedAction.inputs.includes("ROSTER_MEMBER") ? (
        <div>
          <label htmlFor="memberId">Member</label>
          <select id="memberId" name="memberId">
            {selectedTeam.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {discordFullName(member)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {selectedAction.inputs.includes("USER") ? (
        <div>
          <label htmlFor="user">User</label>
          <UserSearch inputName="userId" id="user" />
        </div>
      ) : null}
      <SubmitButton
        _action={selectedAction.type}
        state={fetcher.state}
        variant={
          selectedAction.type === "DELETE_TEAM" ? "destructive" : undefined
        }
      >
        Go
      </SubmitButton>
    </fetcher.Form>
  );
}

function EnableMapList() {
  const data = useOutletContext<TournamentLoaderData>();
  const submit = useSubmit();
  const [eventStarted, setEventStarted] = React.useState(
    Boolean(data.tournament.showMapListGenerator),
  );
  function handleToggle(toggled: boolean) {
    setEventStarted(toggled);

    const data = new FormData();
    data.append("_action", "UPDATE_SHOW_MAP_LIST_GENERATOR");
    data.append("show", toggled ? "on" : "off");

    submit(data, { method: "post" });
  }

  return (
    <div>
      <label>Public map list generator tool</label>
      <Toggle checked={eventStarted} setChecked={handleToggle} name="show" />
    </div>
  );
}

function DownloadParticipants() {
  const { t } = useTranslation(["tournament"]);
  const data = useOutletContext<TournamentLoaderData>();

  function allParticipantsContent() {
    return data.teams
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => {
        const owner = team.members.find((user) => user.isOwner);
        invariant(owner);

        return `${team.name} - ${discordFullName(owner)} - <@${
          owner.discordId
        }>`;
      })
      .join("\n");
  }

  function notCheckedInParticipantsContent() {
    return data.teams
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((team) => !team.checkedInAt)
      .map((team) => {
        return `${team.name} - ${team.members
          .map(
            (member) => `${discordFullName(member)} - <@${member.discordId}>`,
          )
          .join(" / ")}`;
      })
      .join("\n");
  }

  function simpleListInSeededOrder() {
    return data.teams
      .slice()
      .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity))
      .filter((team) => team.checkedInAt)
      .map((team) => team.name)
      .join("\n");
  }

  return (
    <div>
      <label>{t("tournament:admin.download")} (Discord format)</label>
      <div className="stack horizontal sm">
        <Button
          size="tiny"
          onClick={() =>
            handleDownload({
              filename: "all-participants.txt",
              content: allParticipantsContent(),
            })
          }
        >
          All participants
        </Button>
        <Button
          size="tiny"
          onClick={() =>
            handleDownload({
              filename: "not-checked-in-participants.txt",
              content: notCheckedInParticipantsContent(),
            })
          }
        >
          Not checked in participants
        </Button>
        <Button
          size="tiny"
          onClick={() =>
            handleDownload({
              filename: "teams-in-seeded-order.txt",
              content: simpleListInSeededOrder(),
            })
          }
        >
          Simple list in seeded order
        </Button>
      </div>
    </div>
  );
}

function handleDownload({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  const element = document.createElement("a");
  const file = new Blob([content], {
    type: "text/plain",
  });
  element.href = URL.createObjectURL(file);
  element.download = filename;
  document.body.appendChild(element);
  element.click();
}
