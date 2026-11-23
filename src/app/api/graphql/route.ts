import { yoga } from "@/lib/graphql";

type Handler = (request: Request) => Response | Promise<Response>;
const handle = yoga as unknown as Handler;

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}

export function OPTIONS(request: Request) {
  return handle(request);
}
