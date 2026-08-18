export default function DraftBoard({ draftState, players, teams }) {
  // Always-safe values
  const picks = draftState?.picks ?? [];
  const safePlayers = players ?? [];
  const safeTeams = teams ?? [];

  // Fast lookup maps
  const playerMap = Object.fromEntries(safePlayers.map(p => [p.id, p]));
  const teamMap = Object.fromEntries(safeTeams.map(t => [t.id, t]));

  return (
    <div style={{ width: "400px", border: "1px solid #ccc", padding: "10px" }}>
      <h3>Draft Board</h3>

      {picks.length === 0 && <div>No picks yet</div>}

      {picks.map((pick, index) => {
        const player = playerMap[pick.playerId];
        const team = teamMap[pick.teamId];

        return (
          <div
            key={index}
            style={{
              padding: "6px 0",
              borderBottom: "1px solid #eee",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <span>Pick {index + 1}</span>
            <span>{player?.name ?? `Player ${pick.playerId}`}</span>
            <span>{team?.name ?? `Team ${pick.teamId}`}</span>
          </div>
        );
      })}
    </div>
  );
}