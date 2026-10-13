export function notificationLink(link, role) {
  if (link === "/messages") {
    return role === "parent"
      ? "/parent/letters"
      : role === "admin"
        ? "/admin/messages"
        : "/teacher/letters";
  }
  return link;
}
