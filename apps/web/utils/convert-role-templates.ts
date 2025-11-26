const fs = require('fs');
const path = require('path');

// Read the current role-templates.json file
const inputFile = path.join(__dirname, 'role-templates.json');
const outputFile = path.join(__dirname, 'role-templates-object.json');

try {
  // Read the JSON file as buffer first
  const buffer = fs.readFileSync(inputFile);
  const encodingsToTry = ['utf8', 'utf16le'];
  let jsonData;
  let templatesArray;
  let lastError;
  
  for (const encoding of encodingsToTry) {
    try {
      console.log(`Trying ${encoding} decoding...`);
      let candidate = buffer.toString(encoding);
      if (candidate.charCodeAt(0) === 0xFEFF) {
        candidate = candidate.slice(1);
      }
      // remove BOMs and stray NULLs that sometimes show up in UTF-16 exports
      candidate = candidate.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
      console.log(`First 40 chars (${encoding}):`, JSON.stringify(candidate.slice(0, 40)));
      console.log(`Last 40 chars (${encoding}):`, JSON.stringify(candidate.slice(-40)));
      const parsed = JSON.parse(candidate);
      console.log(`Parsed using ${encoding} encoding`);
      jsonData = candidate;
      templatesArray = parsed;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  
  if (!templatesArray) {
    throw lastError || new Error('Unable to parse JSON with the supported encodings');
  }
  
  // Convert array to object with role ID as key
  const templatesObject = {};
  
  templatesArray.forEach(template => {
    const roleId = template.role;
    templatesObject[roleId] = template;
  });
  
  // Write the converted object to a new file
  fs.writeFileSync(outputFile, JSON.stringify(templatesObject, null, 2));
  
  console.log(`✅ Successfully converted ${templatesArray.length} templates`);
  console.log(`📁 Output saved to: ${outputFile}`);
  console.log(`📊 Structure: Object with ${Object.keys(templatesObject).length} role IDs as keys`);
  
  // Show example of the new structure
  const firstKey = Object.keys(templatesObject)[0];
  console.log(`\n📝 Example structure:`);
  console.log(`"${firstKey}": {`);
  console.log(`  "name": "${templatesObject[firstKey].name}",`);
  console.log(`  "role": "${templatesObject[firstKey].role}",`);
  console.log(`  "roleRelation": { ... },`);
  console.log(`  ...`);
  console.log(`}`);
  
} catch (error) {
  console.error('❌ Error converting file:', error.message);
}
