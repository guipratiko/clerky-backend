const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const evolutionApi = require('../services/evolutionApi');
const socketManager = require('../utils/socketManager');

// Listar contatos de uma instância
router.get('/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { limit = 50, offset = 0, search } = req.query;

    let query = { instanceName };
    
    // Filtro de busca
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { pushName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const contacts = await Contact.find(query)
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      data: contacts,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: contacts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao listar contatos:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar contato específico
router.get('/:instanceName/:contactId', async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    
    const contact = await Contact.findOne({ instanceName, contactId });
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contato não encontrado'
      });
    }

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Erro ao buscar contato:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Sincronizar contatos da Evolution API
router.post('/:instanceName/sync', async (req, res) => {
  try {
    const { instanceName } = req.params;

    // Buscar contatos na Evolution API
    const evolutionContacts = await evolutionApi.findContacts(instanceName);

    if (!evolutionContacts || !evolutionContacts.length) {
      return res.json({
        success: true,
        data: [],
        message: 'Nenhum contato encontrado'
      });
    }

    const syncedContacts = [];

    for (const evolutionContact of evolutionContacts) {
      try {
        // Mapear dados do contato
        const contactData = {
          instanceName,
          contactId: evolutionContact.id,
          name: evolutionContact.name || evolutionContact.pushName || evolutionContact.id,
          pushName: evolutionContact.pushName,
          phone: evolutionContact.id.replace('@s.whatsapp.net', ''),
          profilePicture: evolutionContact.profilePicUrl,
          isBusiness: evolutionContact.isBusiness || false,
          isMyContact: evolutionContact.isMyContact !== false
        };

        // Salvar ou atualizar contato
        const contact = await Contact.findOneAndUpdate(
          { instanceName, contactId: evolutionContact.id },
          contactData,
          { upsert: true, new: true }
        );

        syncedContacts.push(contact);

        // Notificar via WebSocket (apenas novos contatos)
        if (contact.createdAt === contact.updatedAt) {
          socketManager.notifyNewContact(instanceName, contact);
        } else {
          socketManager.notifyContactUpdate(instanceName, contact);
        }

      } catch (contactError) {
        console.error('Erro ao processar contato:', evolutionContact.id, contactError);
      }
    }

    res.json({
      success: true,
      data: syncedContacts,
      synced: syncedContacts.length,
      total: evolutionContacts.length
    });

  } catch (error) {
    console.error('Erro ao sincronizar contatos:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Verificar se números são WhatsApp
router.post('/:instanceName/check-whatsapp', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { numbers } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({
        success: false,
        error: 'números devem ser fornecidos como array'
      });
    }

    // Verificar na Evolution API
    const response = await evolutionApi.checkWhatsAppNumbers(instanceName, numbers);

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Erro ao verificar números WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar contato
router.put('/:instanceName/:contactId', async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    const updates = req.body;

    // Campos que podem ser atualizados localmente
    const allowedUpdates = ['name', 'isBlocked', 'status'];
    const filteredUpdates = {};
    
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    // Tentar encontrar o contato existente
    let contact = await Contact.findOne({ instanceName, contactId });
    console.log('🔍 Buscando contato:', { instanceName, contactId, found: !!contact });

    if (!contact) {
      // Se o contato não existe, criar um novo
      const phoneNumber = contactId.replace('@s.whatsapp.net', '');
      console.log('📝 Criando novo contato:', { phoneNumber, name: filteredUpdates.name || updates.name });
      
      contact = new Contact({
        instanceName,
        contactId,
        name: filteredUpdates.name || updates.name || phoneNumber,
        phone: phoneNumber,
        pushName: filteredUpdates.name || updates.name || phoneNumber
      });
      await contact.save();
      console.log('✅ Contato criado com sucesso');
    } else {
      // Atualizar contato existente
      console.log('🔄 Atualizando contato existente');
      contact = await Contact.findOneAndUpdate(
        { instanceName, contactId },
        filteredUpdates,
        { new: true }
      );
    }

    // Notificar via WebSocket
    socketManager.notifyContactUpdate(instanceName, contact);

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Erro ao atualizar contato:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar presença do contato
router.put('/:instanceName/:contactId/presence', async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    const { presence, lastSeen } = req.body;

    const contact = await Contact.findOneAndUpdate(
      { instanceName, contactId },
      { 
        presence,
        ...(lastSeen && { lastSeen: new Date(lastSeen) })
      },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contato não encontrado'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyPresenceUpdate(instanceName, {
      contactId,
      presence,
      lastSeen,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Erro ao atualizar presença:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar contatos por nome ou telefone
router.post('/:instanceName/search', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { query, limit = 20 } = req.body;

    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const contacts = await Contact.find({
      instanceName,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { pushName: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } }
      ]
    })
    .sort({ name: 1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Deletar contato
router.delete('/:instanceName/:contactId', async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;

    const contact = await Contact.findOneAndDelete({ instanceName, contactId });
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contato não encontrado'
      });
    }

    // Notificar via WebSocket
    socketManager.emitToInstance(instanceName, 'contact-deleted', {
      contactId,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Contato deletado'
    });
  } catch (error) {
    console.error('Erro ao deletar contato:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Bloquear/desbloquear contato
router.put('/:instanceName/:contactId/block', async (req, res) => {
  try {
    const { instanceName, contactId } = req.params;
    const { blocked = true } = req.body;

    const contact = await Contact.findOneAndUpdate(
      { instanceName, contactId },
      { isBlocked: blocked },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contato não encontrado'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyContactUpdate(instanceName, contact);

    res.json({
      success: true,
      data: contact,
      message: blocked ? 'Contato bloqueado' : 'Contato desbloqueado'
    });
  } catch (error) {
    console.error('Erro ao bloquear/desbloquear contato:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar nomes dos contatos usando API externa
router.post('/get-names', async (req, res) => {
  try {
    const { numbers } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({
        success: false,
        error: 'números devem ser fornecidos como array'
      });
    }

    // Buscar nomes na API externa
    const response = await evolutionApi.getContactNames(numbers);

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Erro ao buscar nomes dos contatos:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar nome do contato por número de telefone
router.put('/:instanceName/phone/:phoneNumber', async (req, res) => {
  try {
    const { instanceName, phoneNumber } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Nome é obrigatório'
      });
    }

    // Buscar contato pelo número de telefone
    let contact = await Contact.findOne({ 
      instanceName, 
      phone: phoneNumber 
    });

    if (!contact) {
      // Se não encontrar pelo phone, tentar pelo contactId com @s.whatsapp.net
      const contactId = `${phoneNumber}@s.whatsapp.net`;
      contact = await Contact.findOne({ 
        instanceName, 
        contactId 
      });
    }

    if (!contact) {
      // Se ainda não encontrar, criar um novo contato
      const contactId = `${phoneNumber}@s.whatsapp.net`;
      contact = new Contact({
        instanceName,
        contactId,
        name: name,
        phone: phoneNumber,
        pushName: name
      });
      await contact.save();
      console.log('✅ Novo contato criado:', { phoneNumber, name });
    } else {
      // Atualizar contato existente
      contact = await Contact.findOneAndUpdate(
        { _id: contact._id },
        { name, pushName: name },
        { new: true }
      );
      console.log('🔄 Contato atualizado:', { phoneNumber, name });
    }

    // Notificar via WebSocket
    console.log('📡 Notificando atualização do contato via WebSocket:', { instanceName, contactId: contact.contactId, name: contact.name });
    socketManager.notifyContactUpdate(instanceName, contact);

    res.json({
      success: true,
      data: contact
    });
  } catch (error) {
    console.error('Erro ao atualizar nome do contato:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
