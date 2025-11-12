const express = require('express');
const router = express.Router();
const ContactHistory = require('../models/ContactHistory');
const ContactTask = require('../models/ContactTask');
const { authenticateToken } = require('../middleware/auth');

// ========== HISTÓRICO DE CONTATOS ==========

// Listar histórico de um contato
router.get('/history/:instanceName/:contactId', authenticateToken, async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const history = await ContactHistory.find({
      userId: req.user._id,
      instanceName,
      contactId
    })
    .sort({ timestamp: -1 })
    .limit(parseInt(limit))
    .skip(parseInt(offset));

    res.json({
      success: true,
      data: history,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: history.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Adicionar entrada no histórico
router.post('/history', authenticateToken, async (req, res) => {
  try {
    const { instanceName, contactId, contactName, type, title, description, metadata } = req.body;

    if (!instanceName || !contactId || !contactName || !type || !title) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: instanceName, contactId, contactName, type, title'
      });
    }

    const historyEntry = new ContactHistory({
      userId: req.user._id,
      instanceName,
      contactId,
      contactName,
      type,
      title,
      description: description || '',
      metadata: metadata || {},
      createdBy: req.user.email || 'system'
    });

    await historyEntry.save();

    res.json({
      success: true,
      data: historyEntry,
      message: 'Entrada adicionada ao histórico'
    });
  } catch (error) {
    console.error('Erro ao adicionar histórico:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// ========== TAREFAS DE CONTATOS ==========

// Listar tarefas de um contato
router.get('/tasks/:instanceName/:contactId', authenticateToken, async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = {
      userId: req.user._id,
      instanceName,
      contactId
    };

    if (status) {
      query.status = status;
    }

    const tasks = await ContactTask.find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      data: tasks,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: tasks.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Criar nova tarefa
router.post('/tasks', authenticateToken, async (req, res) => {
  try {
    const { 
      instanceName, 
      contactId, 
      contactName, 
      title, 
      description, 
      priority = 'medium',
      dueDate,
      tags = []
    } = req.body;

    if (!instanceName || !contactId || !contactName || !title) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: instanceName, contactId, contactName, title'
      });
    }

    const task = new ContactTask({
      userId: req.user._id,
      instanceName,
      contactId,
      contactName,
      title,
      description: description || '',
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      tags,
      assignedTo: req.user.email || 'current_user'
    });

    await task.save();

    // Adicionar entrada no histórico
    const historyEntry = new ContactHistory({
      userId: req.user._id,
      instanceName,
      contactId,
      contactName,
      type: 'task',
      title: `Nova tarefa: ${title}`,
      description: `Tarefa criada com prioridade ${priority}`,
      metadata: { taskId: task._id }
    });
    await historyEntry.save();

    res.json({
      success: true,
      data: task,
      message: 'Tarefa criada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar tarefa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar tarefa
router.put('/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, status, priority, dueDate, tags } = req.body;

    const task = await ContactTask.findOne({
      _id: taskId,
      userId: req.user._id
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Tarefa não encontrada'
      });
    }

    // Atualizar campos
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
    if (status) {
      task.status = status;
      if (status === 'completed') {
        task.completedAt = new Date();
      } else if (status !== 'completed' && task.completedAt) {
        task.completedAt = null;
      }
    }
    if (priority) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate ? new Date(dueDate) : null;
    if (tags) task.tags = tags;

    await task.save();

    // Adicionar entrada no histórico
    const historyEntry = new ContactHistory({
      userId: req.user._id,
      instanceName: task.instanceName,
      contactId: task.contactId,
      contactName: task.contactName,
      type: 'task',
      title: `Tarefa atualizada: ${task.title}`,
      description: `Status alterado para ${task.status}`,
      metadata: { taskId: task._id, changes: req.body }
    });
    await historyEntry.save();

    res.json({
      success: true,
      data: task,
      message: 'Tarefa atualizada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar tarefa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Deletar tarefa
router.delete('/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await ContactTask.findOne({
      _id: taskId,
      userId: req.user._id
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Tarefa não encontrada'
      });
    }

    await ContactTask.findByIdAndDelete(taskId);

    // Adicionar entrada no histórico
    const historyEntry = new ContactHistory({
      userId: req.user._id,
      instanceName: task.instanceName,
      contactId: task.contactId,
      contactName: task.contactName,
      type: 'task',
      title: `Tarefa removida: ${task.title}`,
      description: 'Tarefa foi deletada',
      metadata: { taskId: task._id }
    });
    await historyEntry.save();

    res.json({
      success: true,
      message: 'Tarefa deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar tarefa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
