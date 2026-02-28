"use client";

export default function PeopleView({
  members,
  assignmentsByMember,
  scoreToPercent,
  onOpenPerson,
}) {
  const counts = members.map(
    (member) => (assignmentsByMember.get(member.id) || []).length
  );
  const avgCount =
    counts.length > 0
      ? counts.reduce((sum, value) => sum + value, 0) / counts.length
      : 0;

  const getWorkload = (count) => {
    if (!count) return { label: "Low", tone: "low" };
    if (avgCount > 0 && count >= avgCount * 1.4) {
      return { label: "High", tone: "high" };
    }
    if (avgCount > 0 && count <= avgCount * 0.6) {
      return { label: "Low", tone: "low" };
    }
    return { label: "Balanced", tone: "balanced" };
  };

  const getStatus = (count) => {
    if (!count) return { label: "Unassigned", tone: "idle" };
    return count >= (avgCount || 1) * 1.4
      ? { label: "Busy", tone: "busy" }
      : { label: "Active", tone: "active" };
  };

  const getAverageMatch = (assignments) => {
    if (!assignments.length) return 0;
    const total = assignments.reduce(
      (sum, item) => sum + (item.semantic_match_score || 0),
      0
    );
    return scoreToPercent(total / assignments.length);
  };

  const getRoleLabel = (member) =>
    member?.role || member?.title || member?.position || "N/A";
  const getEmail = (member) => {
    const email = member?.email || member?.employee_email;
    return email || "";
  };

  return (
    <div className="tb2-members-table">
      <div className="tb2-members-head">
        <span className="tb2-col-member">Member</span>
        <span className="tb2-col-role">Role</span>
        <span className="tb2-col-tasks">Tasks</span>
        <span className="tb2-col-match">Average Skill Match</span>
        <span className="tb2-col-workload">Workload</span>
        <span className="tb2-col-status">Status</span>
      </div>
      <div className="tb2-members-body">
        {members.map((member) => {
          const assignments = assignmentsByMember.get(member.id) || [];
          const count = assignments.length;
          const workload = getWorkload(count);
          const status = getStatus(count);
          const averageMatch = getAverageMatch(assignments);

          return (
            <button
              key={member.id}
              type="button"
              className="tb2-members-row"
              onClick={() => onOpenPerson(member.id)}
            >
              <span className="tb2-member-cell tb2-col-member">
                <span className="tb2-member-avatar">
                  {(member.name || getEmail(member) || "?")[0]}
                </span>
                <span className="tb2-member-name">
                  {member.name || getEmail(member)}
                  {member.name && getEmail(member) && (
                    <span className="tb2-member-sub">{getEmail(member)}</span>
                  )}
                </span>
              </span>
              <span className="tb2-member-role tb2-col-role">
                {getRoleLabel(member)}
              </span>
              <span className="tb2-member-count tb2-col-tasks">{count}</span>
              <span className="tb2-member-match tb2-col-match">
                <span className="tb2-member-match-value">
                  {averageMatch}%
                </span>
                <span className="tb2-member-match-label">Skill Match</span>
              </span>
              <span
                className={`tb2-pill tb2-pill--${workload.tone} tb2-col-workload`}
                aria-label={`Workload ${workload.label}`}
              >
                {workload.label}
              </span>
              <span
                className={`tb2-pill tb2-pill--${status.tone} tb2-col-status`}
              >
                {status.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
