import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaSignature?: string;
  prismaReconnectPromise?: Promise<void>;
  prismaPerformanceMetrics?: {
    queryCount: number;
    databaseDurationMs: number;
  };
};

// Hot reload can retain an instance created before fields or enums were added.
const prismaSchemaSignature = JSON.stringify(Prisma.dmmf.datamodel);

const prismaPerformanceProfilingEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.STAGE_PERFORMANCE_PROFILE === "1";

function createPrismaClient() {
  const client: PrismaClient = new PrismaClient({
    log: prismaPerformanceProfilingEnabled
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "warn" },
          { emit: "stdout", level: "error" },
        ]
      : process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

  if (prismaPerformanceProfilingEnabled) {
    const queryListener = (event: Prisma.QueryEvent) => {
      const metrics = globalForPrisma.prismaPerformanceMetrics ?? {
        queryCount: 0,
        databaseDurationMs: 0,
      };
      metrics.queryCount += 1;
      metrics.databaseDurationMs += event.duration;
      globalForPrisma.prismaPerformanceMetrics = metrics;
      console.info("[stage-performance:query]", {
        durationMs: event.duration,
      });
    };
    client.$on("query" as never, queryListener as never);
  }

  return client;
}

function getDelegateName(modelName: string) {
  return `${modelName.slice(0, 1).toLowerCase()}${modelName.slice(1)}`;
}

function isPrismaClientCompatible(client: PrismaClient) {
  const previewFeatures = (
    client as PrismaClient & { _previewFeatures?: string[] }
  )._previewFeatures;

  return (
    globalForPrisma.prismaSchemaSignature === prismaSchemaSignature &&
    previewFeatures?.includes("relationJoins") === true &&
    Prisma.dmmf.datamodel.models.every((model) => {
      const delegateName = getDelegateName(model.name) as keyof PrismaClient;
      return typeof client[delegateName] !== "undefined";
    })
  );
}

function getPrismaClient() {
  const cachedClient = globalForPrisma.prisma;

  if (cachedClient && isPrismaClientCompatible(cachedClient)) {
    return cachedClient;
  }

  const nextClient = createPrismaClient();
  globalForPrisma.prisma = nextClient;
  globalForPrisma.prismaSchemaSignature = prismaSchemaSignature;
  return nextClient;
}

export const prisma = getPrismaClient();

export function resetPrismaPerformanceMetrics() {
  if (!prismaPerformanceProfilingEnabled) {
    return;
  }

  globalForPrisma.prismaPerformanceMetrics = {
    queryCount: 0,
    databaseDurationMs: 0,
  };
}

export function getPrismaPerformanceMetrics() {
  if (!prismaPerformanceProfilingEnabled) {
    return null;
  }

  const metrics = globalForPrisma.prismaPerformanceMetrics ?? {
    queryCount: 0,
    databaseDurationMs: 0,
  };

  return {
    queryCount: metrics.queryCount,
    databaseDurationMs: Math.round(metrics.databaseDurationMs),
  };
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function reconnectPrismaClient() {
  const pendingReconnect = globalForPrisma.prismaReconnectPromise;

  if (pendingReconnect) {
    return pendingReconnect;
  }

  const reconnectPromise = (async () => {
    await sleep(500);
    await prisma.$connect();
  })();
  globalForPrisma.prismaReconnectPromise = reconnectPromise;

  try {
    await reconnectPromise;
  } finally {
    if (globalForPrisma.prismaReconnectPromise === reconnectPromise) {
      delete globalForPrisma.prismaReconnectPromise;
    }
  }
}

export function isPrismaConnectionError(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P1001"
  ) {
    return true;
  }

  if (error instanceof Error) {
    return (
      error.message.includes("Error in PostgreSQL connection") ||
      error.message.includes("Can't reach database server") ||
      error.message.includes("Engine is not yet connected")
    );
  }

  return false;
}

export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isPrismaConnectionError(error) || attempts <= 1) {
      throw error;
    }

    // This client is shared by parallel React server renders. Disconnecting it
    // here would abort unrelated queries and surface "Engine is not yet
    // connected" errors. A shared reconnect lets in-flight work finish while
    // ensuring concurrent retries wait on the same recovery attempt.
    await reconnectPrismaClient();

    return withPrismaRetry(operation, attempts - 1);
  }
}
