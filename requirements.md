# This is a smart xml editor.

Given a xml file and a xml schema it allows for fast correct edits of the xml file. It renders the xml without useless information. No Less-than sign: <, no Greater-than sign: >, no double quotes: ", no equal signs. It should visually display the hierarchical nature of the information (by nested boxes). The editor should be a keyboard first editor. So you have a cursor/selection to navigate.

The actions on a node are:

* Replace node by another node. This is triggered by typing when a node was selected. The editor then shows dynamically what nodes are available. It fuzzy searches for valid nodes at this position. It might also be triggered by an paste action of a previously copied node. The fuzzy search also takes into account all attributes and children. If they are not allowed for the new node kinde it will not show them. So for replacing a node one might need to first delete the children or attributes. If this is the case maybe deleting the whole subtree might be more efficient.
* Delete node. This is triggered by a deletion action. This is only enabeled if the xml schema allows deletion to happen without invalidating the schema. It will delete all children too.
* Copy node. Stores the node in memory for later insertion.
* Insert attribute. This is triggered by one specific action and after this the editor fuzzy searches the allowed attributes.

The actions on attributes on a node are:

* Delete attribute
* Change value of the attribute: This is triggered by typing. The editor validates the input after every stroke to the allowed attribute values. If the values in the schema are finite it is also fuzzy searching them. If validation fails it shows a helpful message what whas expected and how the input was different.

The actions inside a node are:

* Insert a node: Fuzzy searches valid nodes at the current position.
* Paste a node: It validates the node before placing it there and will only allow it if validation was succesful.

When an new file is created it automatically creates the minimal tree to make it a valid file. If at some point there are multiple kind of nodes allowed but any is required it will produce a placeholder letting the user start editing there. It will (when the placeholder is selected) use fuzzy search to limit the possible nodes.

In order to make intermediate states possible there should be placeholders. So if there are some arbitrary nodes or attributes a placeholder should be placed there.

There should be an "export" functionality: It will store it as a xml file. Exporting is only allowed if the xml validates.

There should also be a "save" functionality: It will store an intermediate representation, which stores the placeholders.

The only thing making an xml not valid should be placeholders. Everything else should be prevented by the editor itself. So in an ideal world "export" should only look if there are placeholders and if not it stores it and gives it the file ending xml. But until we are there the validation against the schema should always be called explicitly.

As XML Schemas are also just xml files the editor should also allow the editing of xml schemas. Of course if the schema changes all linked xml files might be invalid.

The editor allows to open xml schemas referenced at the top of the xml file. Is the file local it will open it in the same editor in a new tab.

Therefore the editor should also have a "migration mode". In this mode it is "okay" to have non-valid xml files. The editor guides to the elements that invalidate it and you can rename the node or delete it. On rename it will not remove all inside nodes (unlike the replace action on nodes in the normal edit mode). It will just highlight the next problem and guide you there. Storing files that have not fully been migrated is okay, the will have a file ending that shows it is in a migration.

When opening an xml file it validates it first and if it is not valid goes automatically in migration mode.

## Dev methodology

Use strict types. Typescript if using javascript. MyPy if using python. Don't compare strings unless parsing. Use enum types and compare them.

Add unit tests for every stateless function.

Add testing xml files and schemas for testing as well as demo for me.
