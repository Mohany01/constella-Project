import { NextResponse } from "next/server";
import { isAuthenticatedUser, readUserFromCookieString } from "./lib/auth";

const PROTECTED_PATHS = [
  "/dashboard",
  "/projects",
  "/tasks",
  "/notifications",
  "/profile",
  "/settings",
  "/help",
];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  const requiresAuth = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (!requiresAuth) {
    return NextResponse.next();
  }

  const user = readUserFromCookieString(
    request.headers.get("cookie") || ""
  );

  if (isAuthenticatedUser(user)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/tasks/:path*",
    "/notifications/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/help/:path*",
  ],
};
