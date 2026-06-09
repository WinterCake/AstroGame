function derivePlayerActivity(slot) {
  const classes = Array.isArray(slot?.user?.class) ? [...slot.user.class] : [];
  const lastActivity = slot?.lastActivity ?? "";
  const rawMinutes = slot?.lastActivityNum;
  const lastActivityMinutes =
    rawMinutes !== "" && rawMinutes != null && !Number.isNaN(Number(rawMinutes))
      ? Number(rawMinutes)
      : null;

  const onVacation = classes.includes("vacation");
  const inactive = classes.includes("inactive");
  const isNoob = classes.includes("noob");
  const isStrong = classes.includes("strong");

  let activityLabel;
  if (onVacation) {
    activityLabel = "Vacances";
  } else if (inactive) {
    activityLabel = "Inactif (7j+)";
  } else if (lastActivity === "(*)") {
    activityLabel = "En ligne";
  } else if (lastActivity) {
    activityLabel = `Actif ${lastActivity}`;
  } else {
    activityLabel = "Actif";
  }

  return {
    playerClasses: classes,
    inactive,
    onVacation,
    isNoob,
    isStrong,
    activityLabel,
    lastActivity: lastActivity || null,
    lastActivityMinutes,
    isAttackableInactive: inactive && !onVacation,
  };
}
