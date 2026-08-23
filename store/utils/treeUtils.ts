
import { ChatTree, StoryNode, StoryTurn, Character } from '../../types';

// Helper to create a fresh tree from a character
export const createInitialTree = (character: Character, initialFirstMessageIndex = 0): ChatTree => {
    const rootId = 'root';
    const messages = (character.firstMessages ?? []).map(m => m.text);
    const clampedInitialIndex = Math.max(0, Math.min(initialFirstMessageIndex, messages.length - 1));

    const nodes: Record<string, StoryNode> = {
        [rootId]: {
            id: rootId,
            parentId: null,
            childrenIds: [],
            selectedChildIndex: clampedInitialIndex,
            content: { id: rootId, text: '', isPlayer: false }, // Dummy root content
            createdAt: Date.now(),
        }
    };

    messages.forEach((msg, index) => {
        const msgId = crypto.randomUUID();
        nodes[msgId] = {
            id: msgId,
            parentId: rootId,
            childrenIds: [],
            selectedChildIndex: 0,
            content: { id: msgId, text: msg, isPlayer: false },
            createdAt: Date.now() + index,
        };
        nodes[rootId].childrenIds.push(msgId);
    });

    return { nodes, rootNodeId: rootId };
};

// Helper to migrate flat history to tree
export const migrateHistoryToTree = (history: StoryTurn[]): ChatTree => {
    const rootId = 'root';
    const nodes: Record<string, StoryNode> = {
        [rootId]: {
            id: rootId,
            parentId: null,
            childrenIds: [],
            selectedChildIndex: 0,
            content: { id: rootId, text: '', isPlayer: false },
            createdAt: Date.now(),
        }
    };

    let parentId = rootId;
    history.forEach((turn, index) => {
        // Ensure unique IDs if missing (though legacy turns should have IDs)
        const nodeId = turn.id || crypto.randomUUID();
        
        nodes[nodeId] = {
            id: nodeId,
            parentId: parentId,
            childrenIds: [],
            selectedChildIndex: 0,
            content: { ...turn, id: nodeId }, // Ensure content has ID
            createdAt: Date.now() + index,
        };
        
        nodes[parentId].childrenIds.push(nodeId);
        nodes[parentId].selectedChildIndex = 0;
        parentId = nodeId;
    });

    return { nodes, rootNodeId: rootId };
};
