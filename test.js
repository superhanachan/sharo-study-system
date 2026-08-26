const fs = require('fs'); const text = fs.readFileSync('egov.xml', 'utf8'); const match = text.match(/<LawName[^>]*>([\s\S]*?)<\/LawName>/); console.log(match ? match[1].trim() : 'None');
