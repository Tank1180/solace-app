import { useEffect, useState } from "react";
import useWebSocket from "../../hooks/useWebSocket";
import { getDraftState } from "../../api/draftApi";
import { getPlayers } from "../../api/playerApi";
import PlayerList from "./PlayerList";
import CurrentPick from "./CurrentPick";
import DraftBoard from "./DraftBoard";

export default function DraftRoom({ leagueId }) {
  const [draftState, setDraftState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);

  const { send } = useWebSocket(leagueId, (msg) => {
    if (msg.event === "player_drafted") {
      setDraftState(msg.payload);
    }

if (msg.event === "pick") {
  console.log("PICK PAYLOAD:", JSON.stringify(msg.payload, null, 2));
  const playerId = msg.payload.playerId ?? msg.payload.player_id;
  const teamId   = msg.payload.teamId   ?? msg.payload.team_id;

  setDraftState(prev => ({
    ...prev,
    picks: [...(prev?.picks ?? []), { playerId, teamId }]
  }));

  setPlayers(prev => prev.filter(p => p.id !== playerId));
}


  });

  useEffect(() => {
    loadState();
    loadPlayers();
    loadTeams();
  }, []);

  const loadState = async () => {
    const state = await getDraftState(leagueId);
    setDraftState({
    ...state,
    picks: state.picks ?? []  // Ensure picks is always an array
  });
};


  const loadPlayers = async () => {
    const data = await getPlayers(leagueId);
    setPlayers(data);
  };

  const loadTeams = async () => {
    const res = await fetch(`http://localhost:8000/teams/league/${leagueId}`);
    const data = await res.json();
    console.log("TEAMS FROM BACKEND:", JSON.stringify(data, null, 2));
    setTeams(data);
  };

  const handleDraftPlayer = (playerId) => {
    const myTeamId = draftState.currentTeamId;
    send("pick", { playerId, teamId: myTeamId });
  };

  if (!draftState) return <div>Loading draft...</div>;

  return (
    <div style={{ display: "flex", gap: "20px", padding: "20px" }}>
      <CurrentPick draftState={draftState} />

      <PlayerList players={players} onDraft={handleDraftPlayer} />

      <DraftBoard draftState={draftState} players={players} teams={teams} />
    </div>
  );
}