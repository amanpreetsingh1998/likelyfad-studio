import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createChatTools, buildEditSystemPrompt } from '@/lib/chat/tools';
import { buildWorkflowContext } from '@/lib/chat/contextBuilder';
import { extractSubgraph } from '@/lib/chat/subgraphExtractor';
import { WorkflowNode } from '@/types';
import { WorkflowEdge } from '@/types/workflow';
import { requireAuth } from "@/lib/auth/guard";
import { creditCostForRun, type RunCostInput } from "@/lib/credits/pricing";
import {
  getBalance,
  getPendingTotal,
  recordPendingCharge,
} from "@/lib/credits/server";

export const maxDuration = 60; // 1 minute timeout

/**
 * What the assistant costs, priced exactly like any other LLM call: from the
 * model id the handler below actually sends, through the same rate card the
 * generation gate bills from. Never a number written down here.
 */
const CHAT_COST: RunCostInput = {
  kind: "llm",
  provider: "gemini",
  modelId: "gemini-3-flash-preview",
};

/**
 * METERED BY HAND, NOT BY withCredits() — and the reason matters.
 *
 * Every other route that spends a provider key goes through the gate. This one
 * cannot: withCredits() reads the handler's response body to bytes before
 * returning it, which is correct for a JSON generation reply and fatal here,
 * because the whole point of this route is a token-by-token stream into
 * useChat. Buffering it would not break billing; it would break the feature.
 *
 * So the two halves the gate does in one place happen in two places here:
 * affordability is checked BEFORE the model is called, and the charge is
 * recorded from onFinish, once the model call has actually completed. That
 * ordering is the same one withCredits holds to — refuse first, bill only what
 * reached a provider — and the same 402 / `insufficient_credits` shape, which
 * is what the client keys its buy-credits prompt off.
 *
 * Before this, the assistant was authenticated but free: a signed-in non-admin,
 * who cannot even reach the canvas this thing edits, could call Gemini through
 * it as often as they liked on the deployment's key.
 */
export async function POST(request: Request) {
  const gate = await requireAuth();
  if (!gate.ok) return gate.response;

  const userId = gate.auth.user.id;
  const charge = creditCostForRun(CHAT_COST);

  // Balance minus what is already outstanding, never the ledger figure alone —
  // the assistant is usually invoked with a workflow mid-run behind it.
  let available: number;
  try {
    const [balance, pending] = await Promise.all([
      getBalance(userId),
      getPendingTotal(userId),
    ]);
    available = balance - pending;
  } catch (err) {
    console.error(
      "[chat] credit check failed:",
      err instanceof Error ? err.message : err
    );
    return new Response("Credit check failed", { status: 500 });
  }

  if (available < charge) {
    return Response.json(
      {
        success: false,
        error: `Not enough credits: the assistant costs ${charge}, you have ${Math.max(
          0,
          available
        )} available.`,
        code: "insufficient_credits",
        required: charge,
        balance: available,
      },
      { status: 402 }
    );
  }

  try {
    const { messages, workflowState, selectedNodeIds } = await request.json() as {
      messages: UIMessage[];
      workflowState?: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
      selectedNodeIds?: string[];
    };

    // Get API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response('GEMINI_API_KEY not configured', { status: 500 });
    }

    // Extract subgraph if nodes are selected, otherwise use full workflow
    const subgraph = extractSubgraph(
      workflowState?.nodes || [],
      workflowState?.edges || [],
      selectedNodeIds || []
    );

    // Build workflow context from selected subgraph
    const context = buildWorkflowContext(
      subgraph.selectedNodes,
      subgraph.selectedEdges
    );

    // Build context-aware system prompt with optional rest summary
    const systemPrompt = buildEditSystemPrompt(context, subgraph.restSummary);

    // Extract node IDs for tool validation
    const nodeIds = (workflowState?.nodes || []).map(n => n.id);

    // Create chat tools with current workflow context
    const tools = createChatTools(nodeIds);

    // Create Google provider with API key
    const google = createGoogleGenerativeAI({ apiKey });

    // Convert UI messages to model messages format
    const modelMessages = await convertToModelMessages(messages);

    // Create streaming response with tool calling
    const result = streamText({
      model: google('gemini-3-flash-preview'),
      system: systemPrompt,
      messages: modelMessages,
      tools: tools,
      toolChoice: 'auto', // Let LLM decide which tool to use
      stopWhen: stepCountIs(3), // Allow multi-step reasoning for complex requests
      // Billed here rather than above, so a call that never reached the model
      // is never charged for — the same rule withCredits applies when it only
      // records a charge for a response that succeeded.
      //
      // The charge is left UNTAGGED by run: the assistant edits a graph, it
      // does not execute one, so there is no workflow run for this to belong
      // to. It settles through the user-wide path, which is exactly what that
      // path is for.
      //
      // A throw here must not fail a stream the user is already reading. The
      // model has answered and the money is spent either way; a lost charge is
      // revenue, and it is logged loudly for the same reason the gate logs its
      // own.
      onFinish: async () => {
        try {
          await recordPendingCharge(userId, charge, CHAT_COST);
        } catch (err) {
          console.error(
            "[chat] FAILED TO RECORD CHARGE — unbilled assistant call:",
            err instanceof Error ? err.message : err,
            { userId, charge }
          );
        }
      },
    });

    // Return the UI message stream response for useChat compatibility
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('[Chat API Error]', error);

    if (error instanceof Error && error.message.includes('429')) {
      return new Response('Rate limit reached. Please wait and try again.', { status: 429 });
    }

    // Check for token/size errors and return 413
    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();
      if (errorMsg.includes('too large') || errorMsg.includes('token limit') || errorMsg.includes('payload') || errorMsg.includes('request entity too large')) {
        return new Response('This workflow is too large for the AI to process. Try selecting fewer nodes.', { status: 413 });
      }
    }

    return new Response(
      error instanceof Error ? error.message : 'Chat request failed',
      { status: 500 }
    );
  }
}
