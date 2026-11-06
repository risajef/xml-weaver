import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'xml-weaver-conformance-'));
try {
  const entry=join(dir,'core.mjs');
  await build({entryPoints:['src/editor-core.ts'],bundle:true,platform:'node',format:'esm',outfile:entry,logLevel:'silent'});
  const core=await import(pathToFileURL(entry));
  const wrap=body=>`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${body}</xs:schema>`;
  const cases=[
    [wrap('<xs:element name="r" type="xs:int"/>'),'<r>1.5</r>'],
    [wrap('<xs:element name="r" type="xs:int"/>'),'<r/>'],
    [wrap('<xs:element name="r" type="xs:int"/>'),'<r>2147483648</r>'],
    [wrap('<xs:element name="r" type="xs:int"/>'),'<r>-2147483648</r>'],
    [wrap('<xs:element name="r" type="xs:decimal"/>'),'<r>1e2</r>'],
    [wrap('<xs:element name="r" type="xs:decimal"/>'),'<r>.5</r>'],
    [wrap('<xs:element name="r" type="xs:boolean"/>'),'<r> true </r>'],
    [wrap('<xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType></xs:element>'),'<r/>'],
    [wrap('<xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string"/><xs:choice><xs:element name="b" type="xs:string"/><xs:element name="c" type="xs:string"/></xs:choice><xs:element name="d" type="xs:string"/></xs:sequence></xs:complexType></xs:element>'),'<r><a>1</a><b>2</b><d>3</d></r>'],
    ['<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:expected"><xs:element name="r" type="xs:string"/></xs:schema>','<r xmlns="urn:wrong">ok</r>'],
    ['<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:expected"><xs:element name="r" type="xs:string"/></xs:schema>','<p:r xmlns:p="urn:expected">ok</p:r>'],
  ];
  cases.push([
    wrap('<xs:element name="r"><xs:complexType><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:complexType></xs:element>'),
    '<r><a>x</a>unexpected</r>',
  ]);
  cases.push([
    wrap('<xs:simpleType name="derived"><xs:restriction base="base"/></xs:simpleType><xs:simpleType name="base"><xs:restriction base="xs:int"/></xs:simpleType><xs:element name="r" type="derived"/>'),
    '<r>17</r>',
  ]);
  cases.push([
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" attributeFormDefault="qualified"><xs:element name="r"><xs:complexType><xs:attribute name="id" type="xs:int" use="required"/></xs:complexType></xs:element></xs:schema>',
    '<r xmlns="urn:t" xmlns:a="urn:t" a:id="7"/>',
  ]);
  const data=cases.map(([xsd,xml])=>{
    const schema=core.parseXmlSchema(xsd),root=core.parseXmlString(xml).root;
    const valid=core.analyzeDocument(root,schema).problems.length===0;
    return {xsd,xml,valid,output:valid?core.serializeXml(root,schema):null,schemaOutput:core.serializeXml(core.parseXmlString(xsd).root,null)};
  });
  const casesPath=join(dir,'cases.json');
  await writeFile(casesPath,JSON.stringify(data));
  const result=spawnSync('python3',['-c',`
import json,sys
from lxml import etree
for case in json.load(open(sys.argv[1])):
 schema=etree.XMLSchema(etree.fromstring(case['xsd'].encode()))
 valid=schema.validate(etree.fromstring(case['xml'].encode()))
 assert valid == case['valid'], (case['xml'], valid, case['valid'])
 if case['output']:
  assert schema.validate(etree.fromstring(case['output'].encode())), case['output']
 etree.XMLSchema(etree.fromstring(case['schemaOutput'].encode()))
print('Independent XSD conformance checks passed.')
`,casesPath],{stdio:'inherit',timeout:10000});
  assert.equal(result.status,0,result.error?.message ?? "Independent conformance check failed");
} finally { await rm(dir,{recursive:true,force:true}); }
