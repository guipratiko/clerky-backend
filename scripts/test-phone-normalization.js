/**
 * Script de teste para normalização de telefones brasileiros
 * 
 * Como usar:
 * node backend/scripts/test-phone-normalization.js
 */

// Função para normalizar telefone brasileiro
function normalizePhoneBR(phone) {
  if (!phone) return null;
  
  // Remove todos os caracteres não numéricos
  const cleanPhone = phone.toString().replace(/\D/g, '');
  
  // Se não tiver 11 dígitos, retorna como está
  if (cleanPhone.length !== 11) {
    return cleanPhone;
  }
  
  // Extrai o DDD (2 primeiros dígitos)
  const ddd = cleanPhone.substring(0, 2);
  
  // DDDs de São Paulo que mantêm o nono dígito
  const ddsSaoPaulo = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
  
  // Se for DDD de São Paulo, mantém os 11 dígitos
  if (ddsSaoPaulo.includes(ddd)) {
    return cleanPhone;
  }
  
  // Para outros DDDs, verifica se tem o nono dígito extra
  const restOfNumber = cleanPhone.substring(2); // 9 dígitos
  
  // Se o terceiro dígito (após DDD) for 9 e tiver 9 dígitos após o DDD
  if (restOfNumber.length === 9 && restOfNumber[0] === '9') {
    // Remove o primeiro 9 (nono dígito extra)
    const normalizedPhone = ddd + restOfNumber.substring(1);
    return normalizedPhone;
  }
  
  return cleanPhone;
}

// Testes
console.log('\n📱 TESTE DE NORMALIZAÇÃO DE TELEFONES BRASILEIROS');
console.log('='.repeat(80));

const testCases = [
  // São Paulo - mantém 11 dígitos
  { input: '11987654321', expected: '11987654321', description: 'São Paulo (SP) - DDD 11' },
  { input: '12987654321', expected: '12987654321', description: 'São José dos Campos (SP) - DDD 12' },
  { input: '19987654321', expected: '19987654321', description: 'Campinas (SP) - DDD 19' },
  
  // Outros estados - remove nono dígito
  { input: '85995688825', expected: '8595688825', description: 'Fortaleza (CE) - DDD 85' },
  { input: '71998765432', expected: '7198765432', description: 'Salvador (BA) - DDD 71' },
  { input: '21987654321', expected: '2187654321', description: 'Rio de Janeiro (RJ) - DDD 21' },
  { input: '62993557070', expected: '6293557070', description: 'Goiânia (GO) - DDD 62' },
  { input: '47991234567', expected: '4791234567', description: 'Joinville (SC) - DDD 47' },
  { input: '51987654321', expected: '5187654321', description: 'Porto Alegre (RS) - DDD 51' },
  { input: '81998765432', expected: '8198765432', description: 'Recife (PE) - DDD 81' },
  
  // Casos especiais
  { input: '11912345678', expected: '11912345678', description: 'SP - começa com 91 (não é 9 extra)' },
  { input: '6299999999', expected: '6299999999', description: 'Telefone com 10 dígitos (mantém)' },
  { input: '(85) 9 9568-8825', expected: '8595688825', description: 'Com formatação - CE' },
  { input: '(11) 9 8765-4321', expected: '11987654321', description: 'Com formatação - SP' },
];

console.log('\n🧪 Executando testes...\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  const result = normalizePhoneBR(test.input);
  const isCorrect = result === test.expected;
  
  if (isCorrect) {
    passed++;
    console.log(`✅ Teste ${index + 1}: ${test.description}`);
    console.log(`   Input:    ${test.input}`);
    console.log(`   Output:   ${result}`);
    console.log(`   Expected: ${test.expected}`);
  } else {
    failed++;
    console.log(`❌ Teste ${index + 1}: ${test.description}`);
    console.log(`   Input:    ${test.input}`);
    console.log(`   Output:   ${result} ❌`);
    console.log(`   Expected: ${test.expected}`);
  }
  console.log('');
});

console.log('='.repeat(80));
console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

if (failed === 0) {
  console.log('✨ Todos os testes passaram! 🎉\n');
  process.exit(0);
} else {
  console.log('⚠️  Alguns testes falharam.\n');
  process.exit(1);
}

