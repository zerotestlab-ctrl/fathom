import { createSchema, createYoga } from "graphql-yoga";
import { getEvent, queryEvents } from "@/lib/db";

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type DecodedEvent {
      id: String!
      chainId: Int!
      address: String!
      eventName: String!
      signature: String
      confidence: String!
      argsJson: String!
      blockNumber: String!
      timestamp: String
      txHash: String!
      logIndex: Int!
    }

    type DecodedEventPage {
      items: [DecodedEvent!]!
      totalCount: Int!
    }

    type Query {
      decodedEvent(id: String!): DecodedEvent
      decodedEvents(
        limit: Int
        offset: Int
        address: String
        chainId: Int
        eventName: String
        orderBy: String
        orderDirection: String
      ): DecodedEventPage!
    }
  `,
  resolvers: {
    Query: {
      decodedEvents: async (
        _parent: unknown,
        args: {
          limit?: number;
          offset?: number;
          address?: string;
          chainId?: number;
          eventName?: string;
          orderDirection?: string;
        },
      ) => {
        const page = await queryEvents({
          address: args.address,
          chainId: args.chainId,
          eventName: args.eventName,
          limit: args.limit ?? 25,
          offset: args.offset ?? 0,
          direction: args.orderDirection === "asc" ? "asc" : "desc",
        });
        return {
          totalCount: page.totalCount,
          items: page.items.map(toGraphql),
        };
      },
      decodedEvent: async (_parent: unknown, args: { id: string }) => {
        const found = await getEvent(args.id);
        return found ? toGraphql(found) : null;
      },
    },
  },
});

function toGraphql(event: {
  id: string;
  chainId: number;
  address: string;
  eventName: string;
  signature: string | null;
  confidence: string;
  args: Record<string, unknown>;
  blockNumber: string;
  blockTimestamp: string | null;
  txHash: string;
  logIndex: number;
}) {
  return {
    id: event.id,
    chainId: event.chainId,
    address: event.address,
    eventName: event.eventName,
    signature: event.signature,
    confidence: event.confidence,
    argsJson: JSON.stringify(event.args),
    blockNumber: event.blockNumber,
    timestamp: event.blockTimestamp,
    txHash: event.txHash,
    logIndex: event.logIndex,
  };
}

export const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  logging: false,
  graphiql: true,
  cors: { origin: "*", credentials: false },
});
