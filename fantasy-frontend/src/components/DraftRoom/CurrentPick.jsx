export default function CurrentPick({ draftState }) {
  return (
    <div style={{ padding: "20px", border: "1px solid #ccc", width: "200px" }}>
      <h2>Current Pick</h2>
      <p>Round: {draftState.current_round}</p>
      <p>Pick: {draftState.current_pick_number}</p>
      <p>Team ID: {draftState.current_team_id ?? "TBD"}</p>
    </div>
  );
}