import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  const movieId = body.movieId;
  const actorId = body.actorId;
  const roleName = body.roleName;
  const roleDescription = body.roleDescription;

  if (
    typeof movieId !== "number" || 
    !Number.isInteger(movieId) || 
    movieId <= 0
  ) {
    return response(400, { message: "movieId must be a positive integer "});
  }

  if (
    typeof actorId !== "number" ||
    !Number.isInteger(actorId) ||
    actorId <= 0
  ) {
    return response(400, { message: "actorId must be a positive integer"})
  }

  if (typeof roleName !== "string" || roleName.trim() === "") {
    return response(400, { message: "roleName must be a non-empty string"});
  }

  if (
    typeof roleDescription !== "string" ||
    roleDescription.trim() === ""
  ) {
    return response(400, {
      message: "roleDescription must be a non-empty string",
    });
  }

  const role: Role = {
    movieId,
    actorId,
    roleName: roleName.trim(),
    roleDescription: roleDescription.trim(),
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: movieKey(role.movieId),
                SK: movieKey(role.movieId),
              },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: {
                PK: actorKey(role.actorId),
                SK: actorKey(role.actorId),
              },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
                ...role,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );

    return response(201, {
      message: "Role added",
      data: role,
    });


  } catch (err) {
    console.error("DynamoDB error:", err);

    if (err instanceof Error && err.name === "TransactionCanceledException") {
      const reasons = (
        err as Error & {
          CancellationReasons?: Array<{ Code?: string }>;
        }
      ).CancellationReasons;

      if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
        return response(404, { message: "Movie not found" });
      }

      if (reasons?.[1]?.Code === "ConditionalCheckFailed") {
        return response(404, { message: "Actor not found" });
      }

      if (reasons?.[2]?.Code === "ConditionalCheckFailed") {
        return response(409, { message: "Role already exists" });
      }

      return response(409, {
        message: "Transaction cancelled. Check the movie, actor and role.",
      });
    }

    return response(500, {
      message: "Internal server error",
    });
  }
};
