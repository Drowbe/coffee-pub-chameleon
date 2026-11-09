  // ---- whiteboard-lib-b-policy.js: who may do what, in one place -----------------------------------------------------
  //
  // The module's two permissions (module.json): view (see the board) and edit (change it). The server decides again on
  // every save (access.write is edit), so this only shapes the screen. Tools and block types never ask host.can
  // themselves; the page asks here. A finer rule later (only the one who made a block may move it, a block only some
  // people see) goes in these functions and nowhere else.
  function createPolicy(host) {
    const edit = host.can('edit');
    return {
      canEdit: edit,
      canUseTool: (tool) => Boolean(tool) && (!tool.edits || edit),
      canCreate: () => edit,
      // Adding a picture from the computer: the same as adding any block, where the host keeps uploads.
      canAddPicture: () => edit && Boolean(host.uploads),
      // A locked block (lib-a) is not changed or deleted by anyone until it is unlocked; locking and unlocking it, and
      // using a timer's controls, is for anyone who may change the board (canLock).
      canChange: (block) => edit && Boolean(block) && block.locked !== true,
      canDelete: (block) => edit && Boolean(block) && block.locked !== true,
      canLock: (block) => edit && Boolean(block),
      canSee: () => true,
    };
  }
